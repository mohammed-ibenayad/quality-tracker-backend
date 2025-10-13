const { query } = require('./connection');

async function testConnection() {
  try {
    console.log('🔍 Testing database connection...');
    
    // Test basic query
    const result = await query('SELECT NOW() as current_time, version() as pg_version');
    console.log('✅ Connection successful!');
    console.log('📅 Current time:', result.rows[0].current_time);
    console.log('🐘 PostgreSQL version:', result.rows[0].pg_version.split(' ')[0]);
    
    // Check tables
    const tables = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log('\n📊 Tables in database:', tables.rowCount);
    tables.rows.forEach(row => {
      console.log(`  ✓ ${row.table_name}`);
    });
    
    // Count records
    const counts = await query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM workspaces) as workspaces,
        (SELECT COUNT(*) FROM requirements) as requirements,
        (SELECT COUNT(*) FROM test_cases) as test_cases,
        (SELECT COUNT(*) FROM versions) as versions
    `);
    
    console.log('\n📈 Record counts:');
    console.log('  Users:', counts.rows[0].users);
    console.log('  Workspaces:', counts.rows[0].workspaces);
    console.log('  Requirements:', counts.rows[0].requirements);
    console.log('  Test Cases:', counts.rows[0].test_cases);
    console.log('  Versions:', counts.rows[0].versions);
    
    console.log('\n🎉 Database is ready for use!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    process.exit(1);
  }
}

testConnection();
