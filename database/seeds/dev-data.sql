-- ============================================
-- Quality Tracker Development Seed Data
-- ============================================

-- Create default admin user
INSERT INTO users (id, email, password_hash, full_name, is_active, email_verified)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'admin@qualitytracker.local', NULL, 'Admin User', true, true)
ON CONFLICT (id) DO NOTHING;

-- Create default workspace
INSERT INTO workspaces (id, name, slug, description, owner_id, is_active)
VALUES 
  ('00000000-0000-0000-0000-000000000002', 'Default Workspace', 'default-workspace', 'Default workspace for single-user mode', '00000000-0000-0000-0000-000000000001', true)
ON CONFLICT (id) DO NOTHING;

-- Add user to workspace as owner
INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
VALUES 
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'owner', NOW())
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Seed data inserted successfully!';
  RAISE NOTICE '📧 Default user: admin@qualitytracker.local';
  RAISE NOTICE '🏢 Default workspace: Default Workspace (slug: default-workspace)';
END $$;
