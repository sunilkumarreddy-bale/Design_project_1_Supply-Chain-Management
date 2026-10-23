# Deploying to Azure

| Part | Azure service | Notes |
|------|---------------|-------|
| API (Express + Socket.io) | App Service, Linux, Node 20 LTS, plan B1 | WebSockets on, Always On, health check `/api/health` |
| Frontend (Vite SPA) | Static Web Apps, Free | SPA fallback in `frontend/public/staticwebapp.config.json` |
| Database | MongoDB Atlas, cluster in an Azure region (e.g. Central India) | Atlas clusters are replica sets, so multi-document transactions work |

Everything is created by `infra/azure/main.bicep` and deployed by `.github/workflows/deploy-azure.yml`
(run manually from the **Actions** tab). Cost: App Service B1 (billed monthly) + Static Web Apps Free +
Atlas (M0 free tier for trials, M10+ for production); check current prices in the Azure and Atlas calculators.

## 1. MongoDB Atlas

1. Create a cluster and choose **Azure** as the provider, in a region close to your API (e.g. Central India).
2. **Database Access**: add a user with read/write on `smart_inventory`.
3. **Network Access**: allow the App Service outbound IPs (Azure portal → your API → *Networking* → *Outbound
   addresses*) and the GitHub runner if the workflow should seed. For a first trial `0.0.0.0/0` works; restrict
   it afterwards.
4. Copy the connection string:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/smart_inventory?retryWrites=true&w=majority`

## 2. Let GitHub deploy to your subscription

**Option A: service principal with a secret (simplest).** Run in Azure Cloud Shell:

```bash
az ad sp create-for-rbac --name smart-inventory-deploy --role Contributor \
  --scopes /subscriptions/$(az account show --query id -o tsv)
```

Store this JSON as the GitHub secret `AZURE_CREDENTIALS` (values from the command output):

```json
{ "clientId": "<appId>", "clientSecret": "<password>", "tenantId": "<tenant>", "subscriptionId": "<subscription id>" }
```

**Option B: OIDC federated credential (no stored password).**

With the Azure CLI on your machine (`az login` first):

```bash
SUB=$(az account show --query id -o tsv)
TENANT=$(az account show --query tenantId -o tsv)
APP=$(az ad app create --display-name smart-inventory-deploy --query appId -o tsv)
az ad sp create --id "$APP"
az role assignment create --assignee "$APP" --role Contributor --scope "/subscriptions/$SUB"
az ad app federated-credential create --id "$APP" --parameters '{
  "name": "github-production",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:sunilkumarreddy-bale/Design_project_1_Supply-Chain-Management:environment:production",
  "audiences": ["api://AzureADTokenExchange"]
}'
echo "AZURE_CLIENT_ID=$APP  AZURE_TENANT_ID=$TENANT  AZURE_SUBSCRIPTION_ID=$SUB"
```

To limit access, assign Contributor on a pre-created resource group instead of the whole subscription.

## 3. GitHub settings

**Settings → Environments → New environment** named `production`, then add these secrets:

| Secret | Value |
|--------|-------|
| `AZURE_CREDENTIALS` | Option A JSON (or, for option B, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`) |
| `MONGODB_URI` | Atlas connection string |
| `JWT_SECRET` | output of `openssl rand -hex 48` |
| `VITE_GOOGLE_MAPS_KEY` | optional |

## 4. Deploy

**Actions → Deploy to Azure → Run workflow.** Inputs: resource group (default `rg-smart-inventory`), API region
(default `centralindia`), frontend region (a Static Web Apps region), name prefix, and whether to seed demo data when the database is empty. The workflow:

1. creates the resource group and runs the Bicep template (App Service plan, API, Static Web App);
2. builds the API, optionally seeds, prunes dev dependencies and zip-deploys it to App Service;
3. builds the SPA with `VITE_API_URL` / `VITE_SOCKET_URL` pointing at the API and uploads it to Static Web Apps;
4. polls `/api/health` and prints both URLs in the run summary.

`CLIENT_ORIGIN` on the API is set to the Static Web App URL automatically. Re-running the workflow updates
everything in place.

## 5. Integrations (optional)

Add keys as App Service settings (portal → API → *Environment variables*), e.g. `SENDGRID_API_KEY` with
`EMAIL_PROVIDER=sendgrid`, `TWILIO_*` with `SMS_PROVIDER=twilio`, `CLOUDINARY_URL`, `GOOGLE_MAPS_API_KEY`,
`ENABLE_PAYMENTS=true` with Razorpay/Stripe keys. Without them the mock drivers stay active. Uploads are stored
on the App Service file system (`/home/site/wwwroot/uploads`) unless Cloudinary or S3 is configured.

## Checks after deploying

* `https://<api>.azurewebsites.net/api/health` returns `{"ok":true,...}`
* Sign in on the Static Web App URL with `admin@example.com` / `Password123!` (if seeded); the green dot in the top
  bar shows the Socket.io connection is live.
* Change the seeded passwords (Users → Reset password) before sharing the URL.

## Azure for Students

Student subscriptions only allow a few regions (Azure Policy "Allowed resource deployment regions"). If the
deployment fails with `RequestDisallowedByAzure` / `RequestDisallowedByPolicy`, check the allowed list in the portal
(Policy → Assignments) and run the workflow again with an allowed API region and frontend region.
