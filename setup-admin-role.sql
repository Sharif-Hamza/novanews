-- Add is_admin column to the profiles table if it doesn't exist
ALTER TABLE IF EXISTS profiles
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Create an RLS policy to allow reading is_admin based on user ID
DROP POLICY IF EXISTS "Users can read their own profile" ON profiles;
CREATE POLICY "Users can read their own profile"
  ON profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Ensure the public can access profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Allow admins to see all profiles
DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;
CREATE POLICY "Admins can read all profiles"
  ON profiles
  FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM profiles WHERE is_admin = true
    )
  );

-- Create a function to create an admin user
CREATE OR REPLACE FUNCTION create_admin_user(admin_email TEXT, admin_password TEXT)
RETURNS TEXT AS $$
DECLARE
  new_user_id UUID;
BEGIN
  -- Create the user if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = admin_email) THEN
    INSERT INTO auth.users (email, password, email_confirmed_at, created_at, updated_at)
    VALUES (admin_email, admin_password, now(), now(), now())
    RETURNING id INTO new_user_id;
    
    -- Set the admin flag in profiles
    INSERT INTO profiles (id, is_admin)
    VALUES (new_user_id, true);
    
    RETURN 'Admin user created successfully';
  ELSE
    -- User exists, update to admin
    new_user_id := (SELECT id FROM auth.users WHERE email = admin_email);
    
    IF EXISTS (SELECT 1 FROM profiles WHERE id = new_user_id) THEN
      UPDATE profiles SET is_admin = true WHERE id = new_user_id;
    ELSE
      INSERT INTO profiles (id, is_admin)
      VALUES (new_user_id, true);
    END IF;
    
    RETURN 'Existing user updated to admin';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Example of how to call this function (you'll do this in the Supabase SQL Editor)
-- SELECT create_admin_user('admin@example.com', 'securepassword123'); 