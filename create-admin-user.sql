-- This script creates an admin user and grants them admin privileges
-- Replace the email and password with your desired admin credentials
-- WARNING: Run this in the Supabase SQL Editor, NOT directly in production!

-- First, ensure the profiles table has the is_admin column
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Insert a new admin user
-- NOTE: This is a direct insert example, in a real setting you'd use Supabase Auth UI
-- or API to create a user with proper password hashing
DO $$
DECLARE
  admin_email TEXT := 'admin@example.com';  -- CHANGE THIS TO YOUR ADMIN EMAIL
  admin_password TEXT := 'your_secure_password_here';  -- CHANGE THIS TO A SECURE PASSWORD
  new_user_id UUID;
BEGIN
  -- Create an admin user if they don't exist
  -- Note: In Supabase, directly inserting into auth.users is typically not recommended
  -- This is for demonstration only, in production use Supabase's built-in functions
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = admin_email) THEN
    -- WARNING: This is not how passwords should be stored in production
    -- Supabase Auth handles proper password hashing
    INSERT INTO auth.users (
      email,
      encrypted_password,  -- WARNING: This needs proper hashing in production
      email_confirmed_at,
      created_at,
      updated_at,
      role
    )
    VALUES (
      admin_email,
      crypt(admin_password, gen_salt('bf')),  -- Basic encryption, not recommended
      now(),
      now(),
      now(),
      'authenticated'
    )
    RETURNING id INTO new_user_id;
    
    -- Set up the profile with admin privileges
    INSERT INTO profiles (id, is_admin)
    VALUES (new_user_id, true);
    
    RAISE NOTICE 'Created admin user: %', admin_email;
  ELSE
    -- User exists, update to admin
    SELECT id INTO new_user_id FROM auth.users WHERE email = admin_email;
    
    IF EXISTS (SELECT 1 FROM profiles WHERE id = new_user_id) THEN
      UPDATE profiles SET is_admin = true WHERE id = new_user_id;
    ELSE
      INSERT INTO profiles (id, is_admin)
      VALUES (new_user_id, true);
    END IF;
    
    RAISE NOTICE 'Updated existing user to admin: %', admin_email;
  END IF;
END $$;

-- Alternative method: Use Supabase Auth Admin API
-- Instead of running this SQL, you can create a user through the Supabase dashboard
-- or using the Auth API, then run this to grant admin privileges:

/*
-- Assuming user was created via Auth UI/API with user_id:
UPDATE profiles 
SET is_admin = true 
WHERE id = 'paste-user-uuid-here';
*/ 