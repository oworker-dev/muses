# SaaS Auth Contract Tests

Add contract tests that verify registration, email verification, login, session lookup, and protected-route behavior.

Browser verification should create a user, confirm protected account routes redirect anonymous users to `/login`, verify the email address through the callback URL, sign in, and return to the requested application path.
