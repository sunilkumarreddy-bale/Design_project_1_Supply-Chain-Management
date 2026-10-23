// Smart Inventory SCM on Azure: API on App Service (Linux, Node 20, WebSockets) + SPA on Static Web Apps.
// The database is MongoDB Atlas (an Azure region is recommended); its connection string is passed in.
@description('Short name used as a prefix for every resource (lowercase letters and digits).')
@minLength(3)
@maxLength(12)
param appName string = 'smartinv'

@description('Region for the App Service plan and API, e.g. centralindia.')
param location string = resourceGroup().location

@description('Static Web Apps is only offered in some regions.')
@allowed(['eastasia', 'centralus', 'eastus2', 'westus2', 'westeurope'])
param staticWebAppLocation string = 'eastasia'

@description('App Service plan SKU. B1 is the smallest tier with Always On.')
param appServiceSku string = 'B1'

@secure()
@description('MongoDB connection string (replica set, e.g. Atlas mongodb+srv://...).')
param mongodbUri string

@secure()
@description('Long random secret used to sign JWTs.')
param jwtSecret string

@description('Requests per rate-limit window per IP.')
param rateLimitMax int = 1000

@description('Extra app settings (integration keys from backend/.env.example), as name/value pairs.')
param extraAppSettings array = []

var suffix = uniqueString(resourceGroup().id)
var apiName = '${appName}-api-${suffix}'

resource staticSite 'Microsoft.Web/staticSites@2023-12-01' = {
  name: '${appName}-web-${suffix}'
  location: staticWebAppLocation
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${appName}-plan-${suffix}'
  location: location
  kind: 'linux'
  sku: {
    name: appServiceSku
  }
  properties: {
    reserved: true
  }
}

var clientOrigin = 'https://${staticSite.properties.defaultHostname}'

resource api 'Microsoft.Web/sites@2023-12-01' = {
  name: apiName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      appCommandLine: 'node dist/server.js'
      alwaysOn: true
      webSocketsEnabled: true
      http20Enabled: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/api/health'
      appSettings: concat(
        [
          { name: 'NODE_ENV', value: 'production' }
          { name: 'MONGODB_URI', value: mongodbUri }
          { name: 'JWT_SECRET', value: jwtSecret }
          { name: 'JWT_EXPIRES_IN', value: '8h' }
          { name: 'CLIENT_ORIGIN', value: clientOrigin }
          { name: 'PUBLIC_BASE_URL', value: 'https://${apiName}.azurewebsites.net' }
          { name: 'RATE_LIMIT_WINDOW_MS', value: '900000' }
          { name: 'RATE_LIMIT_MAX', value: string(rateLimitMax) }
          { name: 'SCHEDULER_INTERVAL_MINUTES', value: '60' }
          // the deployment package already contains compiled code and production node_modules
          { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
          { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '0' }
        ],
        extraAppSettings
      )
    }
  }
}

output apiName string = api.name
output apiUrl string = 'https://${api.properties.defaultHostName}'
output staticWebAppName string = staticSite.name
output frontendUrl string = clientOrigin
