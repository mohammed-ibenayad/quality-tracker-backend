const db = require('../../database/connection');

// ✅ REMOVED: const DEFAULT_WORKSPACE_ID
// ✅ REMOVED: const DEFAULT_USER_ID

/**
 * Import requirements and test cases from exported JSON
 * POST /api/import
 */
const importData = async (req, res) => {
  try {
    const { requirements, testCases, versions, mappings, workspace_id } = req.body;

    // Validate input
    if (!requirements && !testCases && !versions) {
      return res.status(400).json({
        success: false,
        error: 'No data provided. Expected requirements, testCases, or versions.'
      });
    }

    // ✅ REQUIRE workspace_id
    if (!workspace_id) {
      return res.status(400).json({
        success: false,
        error: 'workspace_id is required'
      });
    }

    // ✅ Verify user has access to this workspace
    const accessCheck = await db.query(`
      SELECT role FROM workspace_members
      WHERE workspace_id = $1 AND user_id = $2
    `, [workspace_id, req.user.id]);

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this workspace'
      });
    }

    // ✅ Verify user has write permissions
    const userRole = accessCheck.rows[0].role;
    if (!['owner', 'admin', 'editor'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions to import data'
      });
    }

    const userId = req.user.id;

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
              workspace_id, // ✅ Always use provided workspace_id
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
            // Normalize tags
            let tags = [];
            if (req.tags) {
              if (Array.isArray(req.tags)) {
                tags = req.tags;
              } else if (typeof req.tags === 'string') {
                tags = req.tags.split(',').map(t => t.trim()).filter(t => t);
              }
            }

            await client.query(`
              INSERT INTO requirements (
                id, workspace_id, name, description, type, priority, status, tags, created_by
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              ON CONFLICT (id) DO NOTHING
            `, [
              req.id,
              workspace_id, // ✅ Always use provided workspace_id
              req.name,
              req.description || '',
              req.type || 'functional',
              req.priority || 'medium',
              req.status || 'draft',
              JSON.stringify(tags),
              userId
            ]);

            summary.requirements.imported++;

            // Import requirement-version mappings
            if (req.versions && Array.isArray(req.versions)) {
              for (const versionId of req.versions) {
                try {
                  await client.query(`
                    INSERT INTO requirement_versions (requirement_id, version_id)
                    VALUES ($1, $2)
                    ON CONFLICT (requirement_id, version_id) DO NOTHING
                  `, [req.id, versionId]);
                } catch (error) {
                  // Silently skip invalid version references
                  console.warn(`Skipped version mapping for ${req.id} -> ${versionId}`);
                }
              }
            }
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
            // Normalize tags
            let tags = [];
            if (tc.tags) {
              if (Array.isArray(tc.tags)) {
                tags = tc.tags;
              } else if (typeof tc.tags === 'string') {
                tags = tc.tags.split(',').map(t => t.trim()).filter(t => t);
              }
            }

            // Normalize steps
            let steps = [];
            if (tc.steps) {
              if (Array.isArray(tc.steps)) {
                steps = tc.steps;
              } else if (typeof tc.steps === 'string') {
                try {
                  steps = JSON.parse(tc.steps);
                } catch (e) {
                  steps = [{ action: tc.steps, expected: '' }];
                }
              }
            }

            await client.query(`
              INSERT INTO test_cases (
                id, workspace_id, name, description, type, priority, status,
                steps, expected_result, tags, created_by
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT (id) DO NOTHING
            `, [
              tc.id,
              workspace_id, // ✅ Always use provided workspace_id
              tc.name,
              tc.description || '',
              tc.type || 'manual',
              tc.priority || 'medium',
              tc.status || 'draft',
              JSON.stringify(steps),
              tc.expectedResult || tc.expected_result || '',
              JSON.stringify(tags),
              userId
            ]);

            summary.testCases.imported++;

            // Import test case-version mappings
            if (tc.applicableVersions && Array.isArray(tc.applicableVersions)) {
              for (const versionId of tc.applicableVersions) {
                try {
                  await client.query(`
                    INSERT INTO test_case_versions (test_case_id, version_id)
                    VALUES ($1, $2)
                    ON CONFLICT (test_case_id, version_id) DO NOTHING
                  `, [tc.id, versionId]);
                } catch (error) {
                  console.warn(`Skipped version mapping for ${tc.id} -> ${versionId}`);
                }
              }
            }
          } catch (error) {
            summary.testCases.skipped++;
            summary.testCases.errors.push(`Test Case ${tc.id}: ${error.message}`);
          }
        }
      }

      // 4. Import Mappings (Requirement-TestCase relationships)
      if (mappings && typeof mappings === 'object') {
        for (const [requirementId, testCaseIds] of Object.entries(mappings)) {
          if (Array.isArray(testCaseIds)) {
            for (const testCaseId of testCaseIds) {
              try {
                // ✅ Verify both IDs belong to the same workspace
                const reqCheck = await client.query(
                  'SELECT id FROM requirements WHERE id = $1 AND workspace_id = $2',
                  [requirementId, workspace_id]
                );

                const tcCheck = await client.query(
                  'SELECT id FROM test_cases WHERE id = $1 AND workspace_id = $2',
                  [testCaseId, workspace_id]
                );

                if (reqCheck.rows.length > 0 && tcCheck.rows.length > 0) {
                  await client.query(`
                    INSERT INTO requirement_test_mappings (requirement_id, test_case_id, created_by)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (requirement_id, test_case_id) DO NOTHING
                  `, [requirementId, testCaseId, userId]);

                  summary.mappings.created++;
                } else {
                  console.warn(`Skipped mapping: ${requirementId} -> ${testCaseId} (not in workspace)`);
                }
              } catch (error) {
                summary.mappings.errors.push(
                  `Mapping ${requirementId}->${testCaseId}: ${error.message}`
                );
              }
            }
          }
        }
      }

      // Also handle mappings from testCase.requirementIds
      if (testCases && Array.isArray(testCases)) {
        for (const tc of testCases) {
          if (tc.requirementIds && Array.isArray(tc.requirementIds)) {
            for (const reqId of tc.requirementIds) {
              try {
                // ✅ Verify both IDs belong to the same workspace
                const reqCheck = await client.query(
                  'SELECT id FROM requirements WHERE id = $1 AND workspace_id = $2',
                  [reqId, workspace_id]
                );

                const tcCheck = await client.query(
                  'SELECT id FROM test_cases WHERE id = $1 AND workspace_id = $2',
                  [tc.id, workspace_id]
                );

                if (reqCheck.rows.length > 0 && tcCheck.rows.length > 0) {
                  await client.query(`
                    INSERT INTO requirement_test_mappings (requirement_id, test_case_id, created_by)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (requirement_id, test_case_id) DO NOTHING
                  `, [reqId, tc.id, userId]);

                  summary.mappings.created++;
                } else {
                  console.warn(`Skipped mapping from testCase: ${reqId} -> ${tc.id} (not in workspace)`);
                }
              } catch (error) {
                // Silently skip duplicate mappings
                console.warn(`Duplicate mapping skipped: ${reqId} -> ${tc.id}`);
              }
            }
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Import completed',
      summary
    });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to import data',
      message: error.message
    });
  }
};

module.exports = {
  importData
};