const db = require('../../database/connection');

// Default workspace and user IDs (from seed data)
const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000002';
const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Import requirements and test cases from exported JSON
 * POST /api/import
 */
const importData = async (req, res) => {
  try {
    const { requirements, testCases, versions, mappings } = req.body;

    // Validate input
    if (!requirements && !testCases && !versions) {
      return res.status(400).json({
        success: false,
        error: 'No data provided. Expected requirements, testCases, or versions.'
      });
    }

    const workspaceId = req.body.workspace_id || DEFAULT_WORKSPACE_ID;
    const userId = req.user?.id || DEFAULT_USER_ID;

    const summary = {
      requirements: { imported: 0, skipped: 0, errors: [] },
      testCases: { imported: 0, skipped: 0, errors: [] },
      versions: { imported: 0, skipped: 0, errors: [] },
      mappings: { created: 0, errors: [] }
    };

    await db.transaction(async (client) => {
      // 1. Import Versions First (if provided)
      if (versions && Array.isArray(versions)) {
        for (const version of versions) {
          try {
            await client.query(`
              INSERT INTO versions (
                id, workspace_id, name, description, status,
                planned_release_date, actual_release_date, sort_order,
                is_default, release_notes, created_by
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT (id) DO NOTHING
            `, [
              version.id,
              workspaceId,
              version.name,
              version.description || null,
              version.status || 'Planning',
              version.plannedReleaseDate || null,
              version.actualReleaseDate || null,
              version.sortOrder || 0,
              version.isDefault || false,
              version.releaseNotes || null,
              userId
            ]);
            
            summary.versions.imported++;
          } catch (error) {
            summary.versions.skipped++;
            summary.versions.errors.push(`Version ${version.id}: ${error.message}`);
          }
        }
      }

      // 2. Import Requirements
      if (requirements && Array.isArray(requirements)) {
        for (const req of requirements) {
          try {
            // Validate required fields
            if (!req.id || !req.name) {
              summary.requirements.skipped++;
              summary.requirements.errors.push(`Missing required fields for requirement`);
              continue;
            }

            // Insert requirement
            await client.query(`
              INSERT INTO requirements (
                id, workspace_id, name, description, priority, type, status,
                business_impact, technical_complexity, regulatory_factor,
                usage_frequency, test_depth_factor, min_test_cases,
                owner, category, tags, parent_requirement_id,
                external_id, external_url, version_number, created_by, updated_by
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
              ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                priority = EXCLUDED.priority,
                type = EXCLUDED.type,
                status = EXCLUDED.status,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
            `, [
              req.id,
              workspaceId,
              req.name,
              req.description || '',
              req.priority || 'Medium',
              req.type || 'Functional',
              req.status || 'Active',
              req.businessImpact || null,
              req.technicalComplexity || null,
              req.regulatoryFactor || null,
              req.usageFrequency || null,
              req.testDepthFactor || null,
              req.minTestCases || null,
              req.owner || null,
              req.category || null,
              JSON.stringify(req.tags || []),
              req.parentRequirementId || null,
              req.externalId || null,
              req.externalUrl || null,
              req.versionNumber || null,
              userId,
              userId
            ]);

            // Insert requirement-version mappings
            if (req.versions && Array.isArray(req.versions)) {
              for (const versionId of req.versions) {
                await client.query(`
                  INSERT INTO requirement_versions (requirement_id, version_id)
                  VALUES ($1, $2)
                  ON CONFLICT DO NOTHING
                `, [req.id, versionId]);
              }
            }

            summary.requirements.imported++;
          } catch (error) {
            summary.requirements.skipped++;
            summary.requirements.errors.push(`Requirement ${req.id}: ${error.message}`);
          }
        }
      }

      // 3. Import Test Cases
      if (testCases && Array.isArray(testCases)) {
        for (const tc of testCases) {
          try {
            // Validate required fields
            if (!tc.id || !tc.name) {
              summary.testCases.skipped++;
              summary.testCases.errors.push(`Missing required fields for test case`);
              continue;
            }

            // Insert test case
            await client.query(`
              INSERT INTO test_cases (
                id, workspace_id, name, description, steps, expected_result,
                preconditions, test_data, category, priority, tags,
                automation_status, automation_path, estimated_duration,
                status, assignee, created_by, updated_by
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
              ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                steps = EXCLUDED.steps,
                expected_result = EXCLUDED.expected_result,
                preconditions = EXCLUDED.preconditions,
                test_data = EXCLUDED.test_data,
                category = EXCLUDED.category,
                priority = EXCLUDED.priority,
                tags = EXCLUDED.tags,
                automation_status = EXCLUDED.automation_status,
                automation_path = EXCLUDED.automation_path,
                estimated_duration = EXCLUDED.estimated_duration,
                status = EXCLUDED.status,
                assignee = EXCLUDED.assignee,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
            `, [
              tc.id,
              workspaceId,
              tc.name,
              tc.description || '',
              JSON.stringify(tc.steps || []),
              tc.expectedResult || '',
              tc.preconditions || '',
              tc.testData || '',
              tc.category || '',
              tc.priority || 'Medium',
              JSON.stringify(tc.tags || []),
              tc.automationStatus || 'Manual',
              tc.automationPath || '',
              tc.estimatedDuration || null,
              tc.status || 'Not Run',
              tc.assignee || '',
              userId,
              userId
            ]);

            // Insert test case-version mappings (support both formats)
            const versions = tc.applicableVersions || (tc.version ? [tc.version] : []);
            if (versions && Array.isArray(versions)) {
              for (const versionId of versions) {
                await client.query(`
                  INSERT INTO test_case_versions (test_case_id, version_id)
                  VALUES ($1, $2)
                  ON CONFLICT DO NOTHING
                `, [tc.id, versionId]);
              }
            }

            // Insert requirement-test case mappings
            if (tc.requirementIds && Array.isArray(tc.requirementIds)) {
              for (const reqId of tc.requirementIds) {
                await client.query(`
                  INSERT INTO requirement_test_mappings (requirement_id, test_case_id, coverage_type, created_by)
                  VALUES ($1, $2, $3, $4)
                  ON CONFLICT DO NOTHING
                `, [reqId, tc.id, 'direct', userId]);
                
                summary.mappings.created++;
              }
            }

            summary.testCases.imported++;
          } catch (error) {
            summary.testCases.skipped++;
            summary.testCases.errors.push(`Test case ${tc.id}: ${error.message}`);
          }
        }
      }

      // 4. Import explicit mappings (if provided separately)
      if (mappings && typeof mappings === 'object') {
        for (const [reqId, testCaseIds] of Object.entries(mappings)) {
          if (Array.isArray(testCaseIds)) {
            for (const tcId of testCaseIds) {
              try {
                await client.query(`
                  INSERT INTO requirement_test_mappings (requirement_id, test_case_id, coverage_type, created_by)
                  VALUES ($1, $2, $3, $4)
                  ON CONFLICT DO NOTHING
                `, [reqId, tcId, 'direct', userId]);
                
                summary.mappings.created++;
              } catch (error) {
                summary.mappings.errors.push(`Mapping ${reqId}->${tcId}: ${error.message}`);
              }
            }
          }
        }
      }
    });

    // Return summary
    res.json({
      success: true,
      message: 'Import completed',
      summary: {
        requirements: {
          imported: summary.requirements.imported,
          skipped: summary.requirements.skipped,
          total: requirements?.length || 0
        },
        testCases: {
          imported: summary.testCases.imported,
          skipped: summary.testCases.skipped,
          total: testCases?.length || 0
        },
        versions: {
          imported: summary.versions.imported,
          skipped: summary.versions.skipped,
          total: versions?.length || 0
        },
        mappings: {
          created: summary.mappings.created
        },
        errors: [
          ...summary.requirements.errors,
          ...summary.testCases.errors,
          ...summary.versions.errors,
          ...summary.mappings.errors
        ]
      }
    });

  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({
      success: false,
      error: 'Import failed',
      message: error.message
    });
  }
};

module.exports = {
  importData
};