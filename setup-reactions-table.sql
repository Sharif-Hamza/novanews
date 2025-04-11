-- Create article_reactions table
CREATE TABLE IF NOT EXISTS article_reactions (
  id SERIAL PRIMARY KEY,
  article_id UUID NOT NULL,
  helpful_count INTEGER DEFAULT 0 NOT NULL,
  love_count INTEGER DEFAULT 0 NOT NULL,
  insightful_count INTEGER DEFAULT 0 NOT NULL,
  concerning_count INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(article_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS article_reactions_article_id_idx ON article_reactions(article_id);

-- Create trigger to update updated_at column
CREATE OR REPLACE FUNCTION update_article_reactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to update updated_at on update
DROP TRIGGER IF EXISTS update_article_reactions_updated_at ON article_reactions;
CREATE TRIGGER update_article_reactions_updated_at
BEFORE UPDATE ON article_reactions
FOR EACH ROW
EXECUTE FUNCTION update_article_reactions_updated_at();

-- Set up Row Level Security
-- First, disable RLS if it's enabled
ALTER TABLE article_reactions DISABLE ROW LEVEL SECURITY;

-- Then, enable it again with new policies
ALTER TABLE article_reactions ENABLE ROW LEVEL SECURITY;

-- Remove existing policies
DROP POLICY IF EXISTS article_reactions_select_policy ON article_reactions;
DROP POLICY IF EXISTS article_reactions_service_policy ON article_reactions;
DROP POLICY IF EXISTS article_reactions_insert_policy ON article_reactions;
DROP POLICY IF EXISTS article_reactions_update_policy ON article_reactions;

-- Create a policy that allows everyone to read
CREATE POLICY article_reactions_select_policy
  ON article_reactions
  FOR SELECT
  TO public
  USING (true);

-- Create a policy that allows service_role to do anything
CREATE POLICY article_reactions_service_policy
  ON article_reactions
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create a policy that allows anon to insert (for anonymous reactions)
CREATE POLICY article_reactions_insert_policy
  ON article_reactions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Create a policy that allows anon to update (for anonymous reactions)
CREATE POLICY article_reactions_update_policy
  ON article_reactions
  FOR UPDATE
  TO anon, authenticated
  USING (true);

-- Remove the foreign key constraint since it causes issues
ALTER TABLE IF EXISTS article_reactions 
DROP CONSTRAINT IF EXISTS article_reactions_article_id_fkey;

-- You'll need to run this SQL script in the Supabase SQL Editor
-- Then you can test the reactions API with:
--
-- curl -X GET http://localhost:3005/api/reactions/[article-id]
-- curl -X POST -H "Content-Type: application/json" -d '{"type": "helpful", "add": true}' http://localhost:3005/api/reactions/[article-id] 