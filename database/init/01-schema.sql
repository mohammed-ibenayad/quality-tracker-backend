-- ============================================
-- Quality Tracker Database Schema
-- PostgreSQL 15+ (also compatible with PostgreSQL 12+)
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- USER MANAGEMENT
-- ============================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255), -- NULL allowed for SSO-only users
  full_name VARCHAR(255),
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  email_verified BOOLEAN DEFAULT false,
  last_login TIMESTAMP,
  preferences JSONB DEFAULT '{}', -- User preferences (theme, notifications, etc.)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_active ON users(is_active);

-- ============================================
-- WORKSPACE MANAGEMENT
-- ============================================

CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  slug VARCHAR(100) UNIQUE, -- URL-friendly identifier (e.g., 'acme-project')
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  settings JSONB DEFAULT '{}', -- Workspace-specific settings
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);
CREATE INDEX idx_workspaces_slug ON workspaces(slug);
CREATE INDEX idx_workspaces_active ON workspaces(is_active);

-- ============================================
-- USER-WORKSPACE MEMBERSHIP & ROLES
-- ============================================

CREATE TYPE user_role AS ENUM ('owner', 'admin', 'editor', 'test_executor', 'viewer');

CREATE TABLE workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'viewer',
  invited_by UUID REFERENCES users(id),
  joined_at TIMESTAMP DEFAULT NOW(),
  last_active TIMESTAMP,
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);
CREATE INDEX idx_workspace_members_role ON workspace_members(role);

-- ============================================
-- VERSIONS/RELEASES
-- ============================================

CREATE TYPE version_status AS ENUM ('Planning', 'In Development', 'In Testing', 'Released', 'Deprecated');

CREATE TABLE versions (
  id VARCHAR(50) PRIMARY KEY, -- User-defined like 'v1.0', 'v2.0'
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status version_status NOT NULL DEFAULT 'Planning',
  
  -- Release Dates
  planned_release_date DATE,
  actual_release_date DATE,
  
  -- Version Ordering
  sort_order INTEGER, -- For custom ordering
  is_default BOOLEAN DEFAULT false, -- Default selected version
  
  -- Metadata
  release_notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Custom Fields
  custom_fields JSONB DEFAULT '{}'
);

CREATE INDEX idx_versions_workspace ON versions(workspace_id);
CREATE INDEX idx_versions_status ON versions(status);
CREATE INDEX idx_versions_sort ON versions(sort_order);
CREATE UNIQUE INDEX idx_versions_default ON versions(workspace_id, is_default) WHERE is_default = true;

-- ============================================
-- REQUIREMENTS
-- ============================================

CREATE TYPE requirement_priority AS ENUM ('Critical', 'High', 'Medium', 'Low');
CREATE TYPE requirement_type AS ENUM ('Functional', 'Non-Functional', 'Security', 'Performance', 'Usability', 'Compliance');
CREATE TYPE requirement_status AS ENUM ('Draft', 'Active', 'In Review', 'Approved', 'Deprecated', 'Archived');

CREATE TABLE requirements (
  id VARCHAR(50) PRIMARY KEY, -- Keep user-defined IDs like 'REQ-001'
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  -- Basic Info
  name TEXT NOT NULL,
  description TEXT,
  priority requirement_priority NOT NULL DEFAULT 'Medium',
  type requirement_type NOT NULL DEFAULT 'Functional',
  status requirement_status NOT NULL DEFAULT 'Active',
  
  -- Risk Factors (for Test Depth Factor calculation)
  business_impact INTEGER CHECK (business_impact BETWEEN 1 AND 5),
  technical_complexity INTEGER CHECK (technical_complexity BETWEEN 1 AND 5),
  regulatory_factor INTEGER CHECK (regulatory_factor BETWEEN 1 AND 5),
  usage_frequency INTEGER CHECK (usage_frequency BETWEEN 1 AND 5),
  
  -- Calculated Metrics (can be stored or computed on-the-fly)
  test_depth_factor DECIMAL(3,1), -- Calculated from risk factors
  min_test_cases INTEGER, -- Minimum tests required based on TDF
  
  -- Ownership & Organization
  owner VARCHAR(255), -- Team or person responsible
  category VARCHAR(100), -- Custom categorization
  tags JSONB DEFAULT '[]', -- Array of tags
  
  -- Traceability
  parent_requirement_id VARCHAR(50) REFERENCES requirements(id), -- For hierarchical requirements
  external_id VARCHAR(255), -- Link to external system (JIRA, ADO, etc.)
  external_url TEXT,
  
  -- Version Control
  version_number VARCHAR(50), -- Internal version like '1.0', '2.0'
  
  -- Metadata
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Custom Fields (for extensibility)
  custom_fields JSONB DEFAULT '{}'
);

CREATE INDEX idx_requirements_workspace ON requirements(workspace_id);
CREATE INDEX idx_requirements_status ON requirements(status);
CREATE INDEX idx_requirements_priority ON requirements(priority);
CREATE INDEX idx_requirements_type ON requirements(type);
CREATE INDEX idx_requirements_owner ON requirements(owner);
CREATE INDEX idx_requirements_parent ON requirements(parent_requirement_id);
CREATE INDEX idx_requirements_tags ON requirements USING GIN(tags);

-- ============================================
-- REQUIREMENT-VERSION MAPPING
-- ============================================

CREATE TABLE requirement_versions (
  requirement_id VARCHAR(50) NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  version_id VARCHAR(50) NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  PRIMARY KEY (requirement_id, version_id)
);

CREATE INDEX idx_requirement_versions_requirement ON requirement_versions(requirement_id);
CREATE INDEX idx_requirement_versions_version ON requirement_versions(version_id);

-- ============================================
-- TEST CASES
-- ============================================

CREATE TYPE test_status AS ENUM ('Passed', 'Failed', 'Not Run', 'Blocked', 'Skipped', 'Not Found', 'Running');
CREATE TYPE automation_status AS ENUM ('Automated', 'Manual', 'Semi-Automated', 'Planned');
CREATE TYPE test_priority AS ENUM ('Critical', 'High', 'Medium', 'Low');

CREATE TABLE test_cases (
  id VARCHAR(50) PRIMARY KEY, -- Keep user-defined IDs like 'TC-001'
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  -- Basic Info
  name TEXT NOT NULL,
  description TEXT,
  
  -- Test Details
  steps JSONB DEFAULT '[]', -- Array of test steps
  expected_result TEXT,
  preconditions TEXT, -- Prerequisites for running the test
  test_data TEXT, -- Test data requirements
  
  -- Categorization
  category VARCHAR(100),
  priority test_priority NOT NULL DEFAULT 'Medium',
  tags JSONB DEFAULT '[]',
  
  -- Automation
  automation_status automation_status NOT NULL DEFAULT 'Manual',
  automation_path TEXT, -- Path to automation script
  estimated_duration INTEGER, -- In minutes
  
  -- Current Status
  status test_status NOT NULL DEFAULT 'Not Run',
  
  -- Ownership
  assignee VARCHAR(255), -- Person or team assigned
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  
  -- Execution Tracking
  last_executed TIMESTAMP,
  last_executed_by UUID REFERENCES users(id),
  execution_count INTEGER DEFAULT 0,
  pass_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  
  -- Traceability
  external_id VARCHAR(255), -- Link to external test management system
  external_url TEXT,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Custom Fields
  custom_fields JSONB DEFAULT '{}'
);

CREATE INDEX idx_test_cases_workspace ON test_cases(workspace_id);
CREATE INDEX idx_test_cases_status ON test_cases(status);
CREATE INDEX idx_test_cases_automation ON test_cases(automation_status);
CREATE INDEX idx_test_cases_priority ON test_cases(priority);
CREATE INDEX idx_test_cases_category ON test_cases(category);
CREATE INDEX idx_test_cases_assignee ON test_cases(assignee);
CREATE INDEX idx_test_cases_tags ON test_cases USING GIN(tags);

-- ============================================
-- TEST CASE-VERSION MAPPING (Flexible)
-- ============================================

CREATE TABLE test_case_versions (
  test_case_id VARCHAR(50) NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  version_id VARCHAR(50) NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  PRIMARY KEY (test_case_id, version_id)
);

CREATE INDEX idx_test_case_versions_test ON test_case_versions(test_case_id);
CREATE INDEX idx_test_case_versions_version ON test_case_versions(version_id);

-- ============================================
-- REQUIREMENT-TEST CASE MAPPING
-- ============================================

CREATE TABLE requirement_test_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id VARCHAR(50) NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  test_case_id VARCHAR(50) NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  coverage_type VARCHAR(50), -- e.g., 'direct', 'partial', 'integration'
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  UNIQUE(requirement_id, test_case_id)
);

CREATE INDEX idx_req_test_mapping_requirement ON requirement_test_mappings(requirement_id);
CREATE INDEX idx_req_test_mapping_test ON requirement_test_mappings(test_case_id);

-- ============================================
-- TEST EXECUTION RUNS
-- ============================================

CREATE TYPE execution_trigger AS ENUM ('manual', 'automated', 'scheduled', 'webhook', 'ci_cd');

CREATE TABLE test_execution_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  -- Execution Context
  request_id VARCHAR(100) UNIQUE, -- External request ID from CI/CD
  requirement_id VARCHAR(50) REFERENCES requirements(id),
  version_id VARCHAR(50) REFERENCES versions(id),
  
  -- Execution Details
  trigger_type execution_trigger NOT NULL,
  triggered_by UUID REFERENCES users(id),
  
  -- Status Tracking
  status VARCHAR(50) NOT NULL, -- 'running', 'completed', 'failed', 'cancelled'
  total_tests INTEGER,
  passed_tests INTEGER DEFAULT 0,
  failed_tests INTEGER DEFAULT 0,
  skipped_tests INTEGER DEFAULT 0,
  blocked_tests INTEGER DEFAULT 0,
  
  -- Timing
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  duration INTEGER, -- In milliseconds
  
  -- Environment
  environment VARCHAR(100), -- 'dev', 'staging', 'production'
  build_number VARCHAR(100),
  commit_sha VARCHAR(100),
  branch VARCHAR(255),
  
  -- Links
  ci_cd_url TEXT, -- Link to CI/CD run (GitHub Actions, Jenkins, etc.)
  
  -- Summary
  summary TEXT,
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_execution_runs_workspace ON test_execution_runs(workspace_id);
CREATE INDEX idx_execution_runs_request ON test_execution_runs(request_id);
CREATE INDEX idx_execution_runs_requirement ON test_execution_runs(requirement_id);
CREATE INDEX idx_execution_runs_version ON test_execution_runs(version_id);
CREATE INDEX idx_execution_runs_status ON test_execution_runs(status);
CREATE INDEX idx_execution_runs_started ON test_execution_runs(started_at DESC);

-- ============================================
-- INDIVIDUAL TEST RESULTS
-- ============================================

CREATE TABLE test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_run_id UUID REFERENCES test_execution_runs(id) ON DELETE CASCADE,
  test_case_id VARCHAR(50) NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  
  -- Result Details
  status test_status NOT NULL,
  duration INTEGER, -- In milliseconds
  
  -- Failure Information (when status = 'Failed')
  failure_type VARCHAR(255), -- 'AssertionError', 'TimeoutException', etc.
  failure_message TEXT,
  failure_category VARCHAR(100), -- 'assertion', 'timeout', 'element', etc.
  failure_details JSONB, -- Structured failure data (expected, actual, stacktrace, etc.)
  
  -- Execution Data
  logs TEXT, -- Execution logs
  raw_output TEXT, -- Raw output from test runner
  screenshots JSONB DEFAULT '[]', -- Array of screenshot URLs
  video_url TEXT,
  
  -- Environment
  executed_on VARCHAR(255), -- Machine/agent that ran the test
  browser VARCHAR(100), -- For UI tests
  browser_version VARCHAR(50),
  os VARCHAR(100),
  
  -- Timing
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  
  -- Retry Information
  retry_count INTEGER DEFAULT 0,
  is_retry BOOLEAN DEFAULT false,
  parent_result_id UUID REFERENCES test_results(id), -- For retries
  
  -- Additional Context
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_test_results_workspace ON test_results(workspace_id);
CREATE INDEX idx_test_results_run ON test_results(execution_run_id);
CREATE INDEX idx_test_results_test_case ON test_results(test_case_id);
CREATE INDEX idx_test_results_status ON test_results(status);
CREATE INDEX idx_test_results_created ON test_results(created_at DESC);
CREATE INDEX idx_test_results_failure_category ON test_results(failure_category) WHERE status = 'Failed';

-- ============================================
-- AUDIT LOG
-- ============================================

CREATE TYPE audit_action AS ENUM ('create', 'update', 'delete', 'execute', 'assign', 'comment');
CREATE TYPE audit_entity AS ENUM ('requirement', 'test_case', 'version', 'workspace', 'user', 'mapping', 'execution');

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  
  -- Action Details
  action audit_action NOT NULL,
  entity_type audit_entity NOT NULL,
  entity_id VARCHAR(255) NOT NULL, -- ID of the affected entity
  
  -- Change Details
  old_value JSONB, -- Previous state
  new_value JSONB, -- New state
  changes JSONB, -- Specific fields that changed
  
  -- Context
  ip_address INET,
  user_agent TEXT,
  description TEXT, -- Human-readable description
  
  -- Timestamp
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_workspace ON audit_logs(workspace_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);

-- ============================================
-- COMMENTS & COLLABORATION
-- ============================================

CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  -- What is being commented on
  entity_type VARCHAR(50) NOT NULL, -- 'requirement', 'test_case', 'execution'
  entity_id VARCHAR(255) NOT NULL,
  
  -- Comment Content
  content TEXT NOT NULL,
  author_id UUID NOT NULL REFERENCES users(id),
  
  -- Threading
  parent_comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  
  -- Metadata
  is_resolved BOOLEAN DEFAULT false,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_comments_workspace ON comments(workspace_id);
CREATE INDEX idx_comments_entity ON comments(entity_type, entity_id);
CREATE INDEX idx_comments_author ON comments(author_id);
CREATE INDEX idx_comments_parent ON comments(parent_comment_id);
CREATE INDEX idx_comments_created ON comments(created_at DESC);

-- ============================================
-- QUALITY GATES
-- ============================================

CREATE TABLE quality_gates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version_id VARCHAR(50) REFERENCES versions(id),
  
  name VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Gate Criteria (stored as rules)
  criteria JSONB NOT NULL, -- e.g., {"min_coverage": 80, "max_critical_failures": 0}
  
  is_active BOOLEAN DEFAULT true,
  is_blocking BOOLEAN DEFAULT false, -- If true, prevents release
  
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_quality_gates_workspace ON quality_gates(workspace_id);
CREATE INDEX idx_quality_gates_version ON quality_gates(version_id);
CREATE INDEX idx_quality_gates_active ON quality_gates(is_active);

-- ============================================
-- QUALITY GATE EVALUATIONS
-- ============================================

CREATE TABLE quality_gate_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quality_gate_id UUID NOT NULL REFERENCES quality_gates(id) ON DELETE CASCADE,
  execution_run_id UUID REFERENCES test_execution_runs(id),
  
  passed BOOLEAN NOT NULL,
  results JSONB NOT NULL, -- Detailed evaluation results
  
  evaluated_at TIMESTAMP DEFAULT NOW(),
  evaluated_by UUID REFERENCES users(id)
);

CREATE INDEX idx_gate_evaluations_gate ON quality_gate_evaluations(quality_gate_id);
CREATE INDEX idx_gate_evaluations_run ON quality_gate_evaluations(execution_run_id);
CREATE INDEX idx_gate_evaluations_date ON quality_gate_evaluations(evaluated_at DESC);

-- ============================================
-- INTEGRATIONS (CI/CD, Issue Trackers, etc.)
-- ============================================

CREATE TYPE integration_type AS ENUM ('github_actions', 'jenkins', 'jira', 'azure_devops', 'gitlab', 'slack', 'webhook');

CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  type integration_type NOT NULL,
  name VARCHAR(255) NOT NULL,
  
  -- Configuration (API keys, URLs, etc. - should be encrypted)
  config JSONB NOT NULL,
  
  is_active BOOLEAN DEFAULT true,
  
  -- Metadata
  last_sync TIMESTAMP,
  sync_status VARCHAR(50),
  
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_integrations_workspace ON integrations(workspace_id);
CREATE INDEX idx_integrations_type ON integrations(type);
CREATE INDEX idx_integrations_active ON integrations(is_active);

-- ============================================
-- TRIGGERS FOR UPDATED_AT TIMESTAMPS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to tables with updated_at column
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON workspaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_requirements_updated_at BEFORE UPDATE ON requirements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_test_cases_updated_at BEFORE UPDATE ON test_cases
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_versions_updated_at BEFORE UPDATE ON versions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_comments_updated_at BEFORE UPDATE ON comments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quality_gates_updated_at BEFORE UPDATE ON quality_gates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_integrations_updated_at BEFORE UPDATE ON integrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- HELPFUL VIEWS
-- ============================================

-- View: Test coverage summary per requirement
CREATE OR REPLACE VIEW requirement_coverage_summary AS
SELECT 
    r.id as requirement_id,
    r.name as requirement_name,
    r.workspace_id,
    COUNT(DISTINCT rtm.test_case_id) as total_test_cases,
    COUNT(DISTINCT CASE WHEN tc.status = 'Passed' THEN tc.id END) as passed_tests,
    COUNT(DISTINCT CASE WHEN tc.status = 'Failed' THEN tc.id END) as failed_tests,
    COUNT(DISTINCT CASE WHEN tc.status = 'Not Run' THEN tc.id END) as not_run_tests,
    ROUND(
        CASE 
            WHEN COUNT(DISTINCT rtm.test_case_id) > 0 
            THEN (COUNT(DISTINCT CASE WHEN tc.status = 'Passed' THEN tc.id END)::DECIMAL / COUNT(DISTINCT rtm.test_case_id) * 100)
            ELSE 0 
        END, 
        2
    ) as pass_percentage
FROM requirements r
LEFT JOIN requirement_test_mappings rtm ON r.id = rtm.requirement_id
LEFT JOIN test_cases tc ON rtm.test_case_id = tc.id
GROUP BY r.id, r.name, r.workspace_id;

-- View: Recent test execution summary
CREATE OR REPLACE VIEW recent_execution_summary AS
SELECT 
    ter.id as execution_id,
    ter.workspace_id,
    ter.request_id,
    ter.requirement_id,
    ter.status,
    ter.total_tests,
    ter.passed_tests,
    ter.failed_tests,
    ter.started_at,
    ter.completed_at,
    ter.duration,
    u.full_name as triggered_by_name,
    u.email as triggered_by_email
FROM test_execution_runs ter
LEFT JOIN users u ON ter.triggered_by = u.id
ORDER BY ter.started_at DESC
LIMIT 100;

-- ============================================
-- SCHEMA VERSION TRACKING
-- ============================================

CREATE TABLE schema_version (
  version VARCHAR(20) PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT NOW(),
  description TEXT
);

INSERT INTO schema_version (version, description) 
VALUES ('1.0.0', 'Initial schema with full test tracking support');

-- ============================================
-- COMPLETION MESSAGE
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '✅ Schema creation completed successfully!';
  RAISE NOTICE '📊 Created % tables', (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE');
  RAISE NOTICE '🔍 Created % views', (SELECT COUNT(*) FROM information_schema.views WHERE table_schema = 'public');
  RAISE NOTICE '🎯 Quality Tracker database is ready!';
END $$;
