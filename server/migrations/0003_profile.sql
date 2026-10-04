-- "Sobre" and location on the student profile, both optional and set by the user.
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN location TEXT;
