const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

// Load environment variables
require("dotenv").config({ path: ".env.local" });

// Database configuration
const pool = new Pool({
	user: process.env.DB_USER || "postgres",
	host: process.env.DB_HOST || "localhost",
	database: process.env.DB_NAME || "workshop_db_final",
	password: process.env.DB_PASSWORD || "qwerty",
	port: parseInt(process.env.DB_PORT || "5432"),
	ssl:
		process.env.DB_HOST && process.env.DB_HOST !== "localhost"
			? {
				rejectUnauthorized: false,
				require: true,
			}
			: false,
});

/**
 * Execute SQL queries from a file
 * @param {string} filePath - Path to the SQL file
 * @returns {Promise<void>}
 */
async function executeSqlFile(filePath) {
	try {
		const sqlContent = fs.readFileSync(filePath, "utf8");

		// Split SQL content into individual statements
		const statements = sqlContent
			.split(";")
			.map(stmt => stmt.trim())
			.filter(stmt => stmt.length > 0 && !stmt.startsWith("--"));

		console.log(`📋 Executing ${statements.length} SQL statements...`);

		for (let i = 0; i < statements.length; i++) {
			const statement = statements[i];

			// Skip comments and empty statements
			if (statement.startsWith("--") || statement.length === 0) {
				continue;
			}

			try {
				const result = await pool.query(statement);

				// Log results for SELECT statements
				if (statement.toUpperCase().trim().startsWith("SELECT")) {
					console.log(`📊 Query ${i + 1} results:`, result.rows);
				} else {
					console.log(`✅ Statement ${i + 1} executed successfully`);
				}
			} catch (error) {
				console.error(`❌ Error executing statement ${i + 1}:`, error.message);
				console.error(`Statement: ${statement.substring(0, 100)}...`);
			}
		}

		console.log("✅ SQL file execution completed");
	} catch (error) {
		console.error("❌ Error reading SQL file:", error.message);
		throw error;
	}
}

/**
 * Analyze data quality before cleaning
 * @returns {Promise<Object>} Analysis results
 */
async function analyzeDataQuality() {
	console.log("🔍 Analyzing data quality...");

	try {
		// Check for NULL values
		const nullAnalysis = await pool.query(`
			SELECT 
				COUNT(*) as total_users,
				COUNT(CASE WHEN birth_date IS NULL THEN 1 END) as null_birth_date,
				COUNT(CASE WHEN bio IS NULL THEN 1 END) as null_bio,
				COUNT(CASE WHEN long_bio IS NULL THEN 1 END) as null_long_bio,
				COUNT(CASE WHEN profile_json IS NULL THEN 1 END) as null_profile_json,
				COUNT(CASE WHEN address IS NULL THEN 1 END) as null_address,
				COUNT(CASE WHEN phone_number IS NULL THEN 1 END) as null_phone_number
			FROM users
		`);

		// Check for duplicate phone numbers
		const duplicatePhones = await pool.query(`
			SELECT phone_number, COUNT(*) as count
			FROM users
			WHERE phone_number IS NOT NULL
			GROUP BY phone_number
			HAVING COUNT(*) > 1
			ORDER BY count DESC
		`);

		// Check for duplicate addresses
		const duplicateAddresses = await pool.query(`
			SELECT address, COUNT(*) as count
			FROM users
			WHERE address IS NOT NULL
			GROUP BY address
			HAVING COUNT(*) > 1
			ORDER BY count DESC
		`);

		// Check for duplicate bio content
		const duplicateBios = await pool.query(`
			SELECT bio, COUNT(*) as count
			FROM users
			WHERE bio IS NOT NULL
			GROUP BY bio
			HAVING COUNT(*) > 1
			ORDER BY count DESC
		`);

		const analysis = {
			nullValues: nullAnalysis.rows[0],
			duplicatePhones: duplicatePhones.rows,
			duplicateAddresses: duplicateAddresses.rows,
			duplicateBios: duplicateBios.rows
		};

		console.log("📊 Data Quality Analysis:");
		console.log("NULL Values:", analysis.nullValues);
		console.log("Duplicate Phone Numbers:", analysis.duplicatePhones.length);
		console.log("Duplicate Addresses:", analysis.duplicateAddresses.length);
		console.log("Duplicate Bios:", analysis.duplicateBios.length);

		return analysis;
	} catch (error) {
		console.error("❌ Error analyzing data quality:", error.message);
		throw error;
	}
}

/**
 * Create backup of users and auth tables
 * @returns {Promise<void>}
 */
async function createBackup() {
	console.log("💾 Creating backup tables...");

	try {
		// Create backup tables
		await pool.query("CREATE TABLE IF NOT EXISTS users_backup AS SELECT * FROM users");
		await pool.query("CREATE TABLE IF NOT EXISTS auth_backup AS SELECT * FROM auth");

		// Verify backup
		const verification = await pool.query(`
			SELECT 
				(SELECT COUNT(*) FROM users) as original_users_count,
				(SELECT COUNT(*) FROM users_backup) as backup_users_count,
				(SELECT COUNT(*) FROM auth) as original_auth_count,
				(SELECT COUNT(*) FROM auth_backup) as backup_auth_count
		`);

		console.log("✅ Backup created successfully:", verification.rows[0]);
	} catch (error) {
		console.error("❌ Error creating backup:", error.message);
		throw error;
	}
}

/**
 * Clean NULL values in user data
 * @returns {Promise<void>}
 */
async function cleanNullValues() {
	console.log("🧹 Cleaning NULL values...");

	try {
		// Clean NULL bio fields
		const bioResult = await pool.query(`
			UPDATE users 
			SET bio = 'No bio provided'
			WHERE bio IS NULL
		`);
		console.log(`✅ Updated ${bioResult.rowCount} NULL bio fields`);

		// Clean NULL long_bio fields
		const longBioResult = await pool.query(`
			UPDATE users 
			SET long_bio = 'No detailed bio provided'
			WHERE long_bio IS NULL
		`);
		console.log(`✅ Updated ${longBioResult.rowCount} NULL long_bio fields`);

		// Clean NULL address fields
		const addressResult = await pool.query(`
			UPDATE users 
			SET address = 'Address not provided'
			WHERE address IS NULL
		`);
		console.log(`✅ Updated ${addressResult.rowCount} NULL address fields`);

		// Clean NULL phone_number fields
		const phoneResult = await pool.query(`
			UPDATE users 
			SET phone_number = 'Not provided'
			WHERE phone_number IS NULL
		`);
		console.log(`✅ Updated ${phoneResult.rowCount} NULL phone_number fields`);

		// Clean NULL profile_json fields
		const profileResult = await pool.query(`
			UPDATE users 
			SET profile_json = '{}'::json
			WHERE profile_json IS NULL
		`);
		console.log(`✅ Updated ${profileResult.rowCount} NULL profile_json fields`);

		console.log("✅ NULL values cleaned successfully");
	} catch (error) {
		console.error("❌ Error cleaning NULL values:", error.message);
		throw error;
	}
}

/**
 * Remove duplicate records
 * @returns {Promise<void>}
 */
async function removeDuplicates() {
	console.log("🔄 Removing duplicate records...");

	try {
		// Remove duplicate phone numbers
		const phoneResult = await pool.query(`
			WITH duplicate_phones AS (
				SELECT 
					id,
					phone_number,
					ROW_NUMBER() OVER (PARTITION BY phone_number ORDER BY created_at ASC) as rn
				FROM users
				WHERE phone_number IS NOT NULL 
				AND phone_number != 'Not provided'
			)
			DELETE FROM users 
			WHERE id IN (
				SELECT id 
				FROM duplicate_phones 
				WHERE rn > 1
			)
		`);
		console.log(`✅ Removed ${phoneResult.rowCount} duplicate phone numbers`);

		// Remove duplicate addresses
		const addressResult = await pool.query(`
			WITH duplicate_addresses AS (
				SELECT 
					id,
					address,
					ROW_NUMBER() OVER (PARTITION BY address ORDER BY created_at ASC) as rn
				FROM users
				WHERE address IS NOT NULL 
				AND address != 'Address not provided'
			)
			DELETE FROM users 
			WHERE id IN (
				SELECT id 
				FROM duplicate_addresses 
				WHERE rn > 1
			)
		`);
		console.log(`✅ Removed ${addressResult.rowCount} duplicate addresses`);

		// Remove duplicate bio content
		const bioResult = await pool.query(`
			WITH duplicate_bios AS (
				SELECT 
					id,
					bio,
					ROW_NUMBER() OVER (PARTITION BY bio ORDER BY created_at ASC) as rn
				FROM users
				WHERE bio IS NOT NULL 
				AND bio != 'No bio provided'
				AND LENGTH(bio) > 10
			)
			DELETE FROM users 
			WHERE id IN (
				SELECT id 
				FROM duplicate_bios 
				WHERE rn > 1
			)
		`);
		console.log(`✅ Removed ${bioResult.rowCount} duplicate bio contents`);

		console.log("✅ Duplicate records removed successfully");
	} catch (error) {
		console.error("❌ Error removing duplicates:", error.message);
		throw error;
	}
}

/**
 * Clean orphaned records
 * @returns {Promise<void>}
 */
async function cleanOrphanedRecords() {
	console.log("🧹 Cleaning orphaned records...");

	try {
		// Remove orphaned user_roles
		const rolesResult = await pool.query(`
			DELETE FROM user_roles 
			WHERE user_id NOT IN (SELECT id FROM users)
		`);
		console.log(`✅ Removed ${rolesResult.rowCount} orphaned user roles`);

		// Remove orphaned user_logs
		const logsResult = await pool.query(`
			DELETE FROM user_logs 
			WHERE user_id NOT IN (SELECT id FROM users)
		`);
		console.log(`✅ Removed ${logsResult.rowCount} orphaned user logs`);

		// Remove orphaned user_divisions
		const divisionsResult = await pool.query(`
			DELETE FROM user_divisions 
			WHERE user_id NOT IN (SELECT id FROM users)
		`);
		console.log(`✅ Removed ${divisionsResult.rowCount} orphaned user divisions`);

		// Remove orphaned auth records
		const authResult = await pool.query(`
			DELETE FROM auth 
			WHERE id NOT IN (SELECT auth_id FROM users WHERE auth_id IS NOT NULL)
		`);
		console.log(`✅ Removed ${authResult.rowCount} orphaned auth records`);

		console.log("✅ Orphaned records cleaned successfully");
	} catch (error) {
		console.error("❌ Error cleaning orphaned records:", error.message);
		throw error;
	}
}

/**
 * Main function to clean users data
 * @returns {Promise<void>}
 */
async function cleanUsersData() {
	console.time("Users Data Cleanup");

	try {
		console.log("🚀 Starting users data cleanup process...");

		// Step 1: Analyze current data quality
		const initialAnalysis = await analyzeDataQuality();

		// Step 2: Create backup
		await createBackup();

		// Step 3: Clean NULL values
		await cleanNullValues();

		// Step 4: Remove duplicates
		// await removeDuplicates();

		// Step 5: Clean orphaned records
		// await cleanOrphanedRecords();

		// Step 6: Final analysis
		console.log("📊 Final data quality analysis:");
		const finalAnalysis = await analyzeDataQuality();

		// Step 7: Summary
		const summary = await pool.query(`
			SELECT 
				(SELECT COUNT(*) FROM users_backup) as original_count,
				(SELECT COUNT(*) FROM users) as final_count,
				(SELECT COUNT(*) FROM users_backup) - (SELECT COUNT(*) FROM users) as records_removed
		`);

		console.log("📋 Cleanup Summary:");
		console.log(`Original users: ${summary.rows[0].original_count}`);
		console.log(`Final users: ${summary.rows[0].final_count}`);
		console.log(`Records removed: ${summary.rows[0].records_removed}`);

		console.log("✅ Users data cleanup completed successfully!");
		console.timeEnd("Users Data Cleanup");
	} catch (error) {
		console.error("❌ Users data cleanup failed:", error.message);
		console.timeEnd("Users Data Cleanup");
		process.exit(1);
	} finally {
		await pool.end();
	}
}

// Run the cleanup if this script is executed directly
if (require.main === module) {
	cleanUsersData();
}

module.exports = {
	cleanUsersData,
	analyzeDataQuality,
	createBackup,
	cleanNullValues,
	// removeDuplicates,
	// cleanOrphanedRecords,
	executeSqlFile
};
