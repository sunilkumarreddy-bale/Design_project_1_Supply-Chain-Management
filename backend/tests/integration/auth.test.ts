import { User } from '../../src/models';
import { api, auth, clearDb, makeUser, PASSWORD, settle, startDb, stopDb } from './helpers';
import { signToken } from '../../src/utils/jwt';
import { AuditLog } from '../../src/models';

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

describe('auth', () => {
  it('registers a staff account and returns a token', async () => {
    const r = await api().post('/api/auth/register').send({ name: 'New Person', email: 'New@Example.com', password: 'longenough1' });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ email: 'new@example.com', role: 'staff' });
    expect(r.body.user.passwordHash).toBeUndefined();
    expect(r.body.token).toEqual(expect.any(String));
    const dup = await api().post('/api/auth/register').send({ name: 'X', email: 'new@example.com', password: 'longenough1' });
    expect(dup.status).toBe(409);
  });

  it('validates registration input', async () => {
    const r = await api().post('/api/auth/register').send({ name: '', email: 'bad', password: 'short' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['email', 'name', 'password']);
  });

  it('logs in, updates lastLoginAt and writes a user.login audit entry', async () => {
    const { email, user } = await makeUser('staff');
    const r = await api().post('/api/auth/login').send({ email, password: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.user._id).toBe(user._id.toHexString());
    expect((await User.findById(user._id))!.lastLoginAt).toBeInstanceOf(Date);
    await settle();
    expect(await AuditLog.countDocuments({ action: 'user.login', entityId: user._id.toHexString() })).toBe(1);
    const me = await api().get('/api/auth/me').set(auth(r.body.token));
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
  });

  it('rejects bad credentials', async () => {
    const { email } = await makeUser('staff');
    const r = await api().post('/api/auth/login').send({ email, password: 'wrong-password' });
    expect(r.status).toBe(401);
    expect(r.body.error.message).toBe('Invalid email or password');
  });

  it('rejects inactive users at login and on every request', async () => {
    const { email, user, token } = await makeUser('staff', { isActive: false });
    expect((await api().post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(401);
    const r = await api().get('/api/auth/me').set(auth(token));
    expect(r.status).toBe(401);
    expect(r.body.error.message).toMatch(/deactivated/);
    expect(user.isActive).toBe(false);
  });

  it('rejects missing, invalid and expired tokens', async () => {
    expect((await api().get('/api/auth/me')).status).toBe(401);
    expect((await api().get('/api/auth/me').set(auth('garbage'))).status).toBe(401);
    const { user } = await makeUser('staff');
    const expired = signToken({ sub: user._id.toHexString(), role: 'staff' }, '-1s');
    const r = await api().get('/api/auth/me').set(auth(expired));
    expect(r.status).toBe(401);
    expect(r.body.error.message).toMatch(/expired/);
  });

  it('updates the profile and notification preferences', async () => {
    const { token } = await makeUser('staff');
    const bad = await api().patch('/api/auth/me').set(auth(token)).send({ notify: { sms: true } });
    expect(bad.status).toBe(400);
    const r = await api().patch('/api/auth/me').set(auth(token)).send({ name: 'Renamed', phone: '+919876543210', notify: { sms: true, email: false } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Renamed', phone: '+919876543210', notify: { inApp: true, email: false, sms: true } });
    expect((await api().patch('/api/auth/me').set(auth(token)).send({ phone: '98765' })).status).toBe(400);
  });

  it('changes the password with the current password', async () => {
    const { token, email } = await makeUser('staff');
    expect((await api().post('/api/auth/change-password').set(auth(token)).send({ currentPassword: 'nope', newPassword: 'NewPassword1!' })).status).toBe(400);
    expect((await api().post('/api/auth/change-password').set(auth(token)).send({ currentPassword: PASSWORD, newPassword: 'NewPassword1!' })).status).toBe(200);
    expect((await api().post('/api/auth/login').send({ email, password: 'NewPassword1!' })).status).toBe(200);
  });
});

describe('users (admin)', () => {
  it('lets an admin create, update and reset users; denies others', async () => {
    const admin = await makeUser('admin');
    const staff = await makeUser('staff');
    expect((await api().get('/api/users').set(auth(staff.token))).status).toBe(403);
    const created = await api()
      .post('/api/users')
      .set(auth(admin.token))
      .send({ name: 'Mgr', email: 'mgr@test.local', password: 'Password123!', role: 'warehouse_manager' });
    expect(created.status).toBe(201);
    expect(created.body.passwordHash).toBeUndefined();
    const noSupplier = await api().post('/api/users').set(auth(admin.token)).send({ name: 'S', email: 's@test.local', password: 'Password123!', role: 'supplier' });
    expect(noSupplier.status).toBe(400);
    const upd = await api().patch(`/api/users/${created.body._id}`).set(auth(admin.token)).send({ isActive: false, role: 'staff' });
    expect(upd.body).toMatchObject({ isActive: false, role: 'staff' });
    expect((await api().post(`/api/users/${created.body._id}/reset-password`).set(auth(admin.token)).send({ newPassword: 'Another123!' })).status).toBe(200);
    const self = await api().patch(`/api/users/${admin.user._id}`).set(auth(admin.token)).send({ isActive: false });
    expect(self.status).toBe(400);
    const list = await api().get('/api/users?role=staff').set(auth(admin.token));
    expect(list.body.total).toBe(2);
    await settle();
    const entries = await AuditLog.find({ entityType: 'User', action: { $in: ['user.create', 'user.update'] } }).lean();
    expect(entries.length).toBe(2);
    expect(JSON.stringify(entries)).not.toMatch(/passwordHash/);
  });
});
