CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase ON users(lower(email));
