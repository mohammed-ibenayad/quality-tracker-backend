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

    if (!requirements && !testCases && !versions) {
      return res.status(400).json({
        success: false,
        error: 'No data provided. Expected requirements, testCases, or versions.'
      });
    }

    if (!workspace_id) {
      return res.status(400).json({
        success: false,
        error: 'workspace_id is required'
      });
    }

    // Verify user has access to this workspace
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
      mappings: { imported: 0, skipped: 0, errors: [] }
    };

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Import Versions
      if (versions && Array.isArray(versions)) {
        for (const ver of versions) {
          try {
            await client.query(`
              INSERT INTO versions (
                id, workspace_id, name, description, status, 
                planned_release_date, actual_release_date, sort_order, 
                is_default, release_notes, created_by
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT (id) DO NOTHING
            `, [
              ver.id,
              workspace_id,
              ver.name,
              ver.description || '',
              ver.status || 'Planned',
              ver.planned_release_date || null,
              ver.actual_release_date || null,
              ver.sort_order || 0,
              ver.is_default || false,
              ver.release_notes || '',
              userId
            ]);

            summary.versions.imported++;
          } catch (error) {
            summary.versions.skipped++;
            summary.versions.errors.push(`Version ${ver.id}: ${error.message}`);
          }
        }
      }

      // 2. Import Requirements
      if (requirements && Array.isArray(requirements)) {
        for (const req of requirements) {
          try {
            let tags = [];
            if (req.tags) {
              if (Array.isArray(req.tags)) {
                tags = req.tags;
              } else if (typeof req.tags === 'string') {
                tags = req.tags.split(',').map(t => t.trim()).filter(t => t);
              }
            }

            const normalizeEnumValue = (value, defaultValue) => {
              if (!value) return defaultValue;
              return value.split(/[\s-_]/).map(word =>
                word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
              ).join(' ');
            };

            await client.query(`
              INSERT INTO requirements (
                id, workspace_id, name, description, type, priority, status, tags, created_by
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              ON CONFLICT (id) DO NOTHING
            `, [
              req.id,
              workspace_id,
              req.name,
              req.description || '',
              normalizeEnumValue(req.type, 'Functional'),
              normalizeEnumValue(req.priority, 'Medium'),
              normalizeEnumValue(req.status, 'Active'),
              JSON.stringify(tags),
              userId
            ]);

            summary.requirements.imported++;

            // ✅ Import requirement-version mappings with UUID conversion
            if (req.versions && Array.isArray(req.versions)) {
              // Get req_uuid
              const reqUuidResult = await client.query(
                'SELECT req_uuid FROM requirements WHERE id = $1',
                [req.id]
              );

              if (reqUuidResult.rows.length > 0) {
                const req_uuid = reqUuidResult.rows[0].req_uuid;

                for (const versionId of req.versions) {
                  try {
                    // Get ver_uuid
                    const verUuidResult = await client.query(
                      'SELECT ver_uuid FROM versions WHERE id = $1',
                      [versionId]
                    );

                    if (verUuidResult.rows.length > 0) {
                      const ver_uuid = verUuidResult.rows[0].ver_uuid;

                      await client.query(`
                        INSERT INTO requirement_versions (requirement_id, version_id)
                        VALUES ($1, $2)
                        ON CONFLICT (requirement_id, version_id) DO NOTHING
                      `, [req_uuid, ver_uuid]);
                    }
                  } catch (error) {
                    console.warn(`Skipped version mapping for ${req.id} -> ${versionId}`);
                  }
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
            let tags = [];
            if (tc.tags) {
              if (Array.isArray(tc.tags)) {
                tags = tc.tags;
              } else if (typeof tc.tags === 'string') {
                tags = tc.tags.split(',').map(t => t.trim()).filter(t => t);
              }
            }

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
                id, workspace_id, name, description, category, priority, status,
                automation_status, steps, expected_result, tags, created_by
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
              ON CONFLICT (id) DO NOTHING
            `, [
              tc.id,
              workspace_id,
              tc.name,
              tc.description || '',
              tc.category || null,
              tc.priority || 'Medium',
              tc.status || 'Not Run',
              tc.automation_status || tc.type || 'Manual',
              JSON.stringify(steps),
              tc.expectedResult || tc.expected_result || '',
              JSON.stringify(tags),
              userId
            ]);

            summary.testCases.imported++;

            // ✅ Import test case-version mappings with UUID conversion
            if (tc.applicableVersions && Array.isArray(tc.applicableVersions)) {
              // Get tc_uuid
              const tcUuidResult = await client.query(
                'SELECT tc_uuid FROM test_cases WHERE id = $1',
                [tc.id]
              );

              if (tcUuidResult.rows.length > 0) {
                const tc_uuid = tcUuidResult.rows[0].tc_uuid;

                for (const versionId of tc.applicableVersions) {
                  try {
                    // Get ver_uuid
                    const verUuidResult = await client.query(
                      'SELECT ver_uuid FROM versions WHERE id = $1',
                      [versionId]
                    );

                    if (verUuidResult.rows.length > 0) {
                      const ver_uuid = verUuidResult.rows[0].ver_uuid;

                      await client.query(`
                        INSERT INTO test_case_versions (test_case_id, version_id)
                        VALUES ($1, $2)
                        ON CONFLICT (test_case_id, version_id) DO NOTHING
                      `, [tc_uuid, ver_uuid]);
                    }
                  } catch (error) {
                    console.warn(`Skipped version mapping for ${tc.id} -> ${versionId}`);
                  }
                }
              }
            }
          } catch (error) {
            summary.testCases.skipped++;
            summary.testCases.errors.push(`Test Case ${tc.id}: ${error.message}`);
          }
        }
      }

      // 4. ✅ Import Mappings with UUID conversion
      if (mappings && typeof mappings === 'object') {
        for (const [requirementId, testCaseIds] of Object.entries(mappings)) {
          if (Array.isArray(testCaseIds)) {
            // Get req_uuid
            const reqUuidResult = await client.query(
              'SELECT req_uuid FROM requirements WHERE id = $1 AND workspace_id = $2',
              [requirementId, workspace_id]
            );

            if (reqUuidResult.rows.length > 0) {
              const req_uuid = reqUuidResult.rows[0].req_uuid;

              for (const testCaseId of testCaseIds) {
                try {
                  // Get tc_uuid
                  const tcUuidResult = await client.query(
                    'SELECT tc_uuid FROM test_cases WHERE id = $1 AND workspace_id = $2',
                    [testCaseId, workspace_id]
                  );

                  if (tcUuidResult.rows.length > 0) {
                    const tc_uuid = tcUuidResult.rows[0].tc_uuid;

                    await client.query(`
                      INSERT INTO requirement_test_mappings (requirement_id, test_case_id, created_by)
                      VALUES ($1, $2, $3)
                      ON CONFLICT (requirement_id, test_case_id) DO NOTHING
                    `, [req_uuid, tc_uuid, userId]);

                    summary.mappings.imported++;
                  }
                } catch (error) {
                  summary.mappings.skipped++;
                  console.warn(`Skipped mapping: ${requirementId} -> ${testCaseId}`);
                }
              }
            }
          }
        }
      }

      // Also handle mappings from testCase.requirementIds
      if (testCases && Array.isArray(testCases)) {
        for (const tc of testCases) {
          if (tc.requirementIds && Array.isArray(tc.requirementIds)) {
            // Get tc_uuid
            const tcUuidResult = await client.query(
              'SELECT tc_uuid FROM test_cases WHERE id = $1 AND workspace_id = $2',
              [tc.id, workspace_id]
            );

            if (tcUuidResult.rows.length > 0) {
              const tc_uuid = tcUuidResult.rows[0].tc_uuid;

              for (const reqId of tc.requirementIds) {
                try {
                  // Get req_uuid
                  const reqUuidResult = await client.query(
                    'SELECT req_uuid FROM requirements WHERE id = $1 AND workspace_id = $2',
                    [reqId, workspace_id]
                  );

                  if (reqUuidResult.rows.length > 0) {
                    const req_uuid = reqUuidResult.rows[0].req_uuid;

                    await client.query(`
                      INSERT INTO requirement_test_mappings (requirement_id, test_case_id, created_by)
                      VALUES ($1, $2, $3)
                      ON CONFLICT (requirement_id, test_case_id) DO NOTHING
                    `, [req_uuid, tc_uuid, userId]);

                    summary.mappings.imported++;
                  }
                } catch (error) {
                  summary.mappings.skipped++;
                  console.warn(`Skipped mapping from testCase: ${reqId} -> ${tc.id}`);
                }
              }
            }
          }
        }
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Import completed',
        summary
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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