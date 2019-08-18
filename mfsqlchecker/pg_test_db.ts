import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as pg from "pg";
import { parse } from "pg-connection-string";
import { closePg, connectPg } from "./pg_extra";

export function isMigrationFile(fileName: string) {
    return fileName.charAt(0) === "V" && fileName.endsWith(".sql");
}

export async function calcDbMigrationsHash(migrationsDir: string): Promise<string> {

    const hash = await calcDirectoryContentsHash("sha1", migrationsDir, isMigrationFile);
    return hash;
}

/**
 * Calculate a cryptographic hash of the contents of a directory. This can be
 * used to detect if any files in the directory have changed (or were
 * added/removed).
 *
 * @param hashAlgorithm An algorithm supported by the crypto module. For
 * example, "sha1" or "md5"
 *
 * @param dir The directory to be scanned. NOTE: There is currently a limitation
 * where this directory can only contain files (no subdirectories)
 *
 * @param fileFilter A filter that can be used to ignore certain files. Only
 * files that pass the filter will be used.
 */
async function calcDirectoryContentsHash(hashAlgorithm: string, dir: string, fileFilter: (fileName: string) => boolean): Promise<string> {
    const allFiles = await readdirAsync(dir);

    const matchingFiles = allFiles.filter(fileFilter).sort();

    const shasum = crypto.createHash(hashAlgorithm);
    for (const fileName of matchingFiles) {
        shasum.update(fileName);
        const fileHash = await calcFileHash(path.join(dir, fileName), hashAlgorithm);
        shasum.update(fileHash);
    }

    return shasum.digest("hex");
}

/**
 * Connect to the same database cluster, but a different database
 */
export function connReplaceDbName(url: string, dbName: string): string {
    const p = parse(url);
    return `postgres://${p.user}:${p.password}@${p.host}:${p.port}/${dbName}${p.ssl === true ? "?ssl=true" : ""}`;
}

/**
 * Safety feature to prevent us messing with or deleting the production database!!!!
 */
function isTestDatabaseCluster(url: string): boolean {
    const p = parse(url);
    return p.host === "localhost" || p.host === "127.0.0.1";
}

async function logWithTiming<A>(message: string, action: () => Promise<A>) {
    const startTime = new Date();
    const result = await action();
    const endTime = new Date();
    const totalTime = endTime.getTime() - startTime.getTime();
    console.log(`${totalTime}ms ${message}`);
    return result;
}

export function validateTestDatabaseCluster(url: string): void {
    if (!isTestDatabaseCluster(url)) {
        let err: string = "";
        err += "About to run tests, but I have detected that this is not a test database cluster!\n";
        err += "Aborting for your safety!\n";
        err += `This is the database you requested to connect to: ${JSON.stringify(url)}`;
        throw new Error(err);
    }
}

async function createMedflytTemplateDatabase(_adminUrl: string, adminConn: pg.Client, medflytDbTemplate: string): Promise<void> {
    // Use a temporary name and then only at the end rename, to ensure that an
    // interrupted migration won't leave after it broken template database
    const tmpName = await tmpDatabaseName();

    await createBlankDatabase(adminConn, tmpName);

    let success = false;
    try {
        await logWithTiming("Run migrations on new MedFlyt template db", () => {
            throw new Error("TODO");
            // await flywayMigrateDatabase(connReplaceDbName(adminUrl, tmpName));
        });
        success = true;
    } finally {
        if (!success) {
            // If the migration failed then clean up after ourselves.

            await dropDatabase(adminConn, tmpName);
        }
    }

    await renameDatabase(adminConn, tmpName, medflytDbTemplate);
}

/**
 * You should call `destroyTestDb` when you are finished. But you may choose not
 * to if you want to leave the database around for manual inspection of it.
 *
 * @param name An optional name to call the database. WARNING: IF IT EXISTS IT
 * WILL BE COMPLETELY ERASED!
 *
 * @returns the name of the new database
 */
export async function createTestDb(adminUrl: string, name?: string): Promise<string> {
    validateTestDatabaseCluster(adminUrl);

    const dbMigrationsHash = await logWithTiming("Calculate migrations hash", () => {
        throw new Error("TODO");
        // return calcDbMigrationsHash();
    });

    const medflytDbTemplate = `medflyt_template_${dbMigrationsHash}`;

    const newDbName = name !== undefined
        ? name
        : await testDatabaseName();

    const adminConn1 = await connectPg(adminUrl);
    try {
        const medflytDbTemplateExists = await databaseExists(adminConn1, medflytDbTemplate);
        if (!medflytDbTemplateExists) {
            await createMedflytTemplateDatabase(adminUrl, adminConn1, medflytDbTemplate);
        }

        if (name !== undefined) {
            await logWithTiming(`Delete (possibly) existing test database: ${name}`, async () => {
                await dropDatabase(adminConn1, name);
            });
        }

        await logWithTiming(`Clone MedFlyt template db to: ${newDbName}`, async () => {
            await cloneDatabase(adminConn1, medflytDbTemplate, newDbName);
        });
    } finally {
        await closePg(adminConn1);
    }

    return newDbName;
}

/**
 * @param testDb the name of the database, as returned from `createTestDb`
 */
export async function destroyTestDb(adminUrl: string, testDb: string): Promise<void> {
    validateTestDatabaseCluster(adminUrl);

    const adminConn2 = await connectPg(adminUrl);
    try {
        await logWithTiming(`Drop test db: ${testDb}`, async () => {
            await dropDatabase(adminConn2, testDb);
        });
    } finally {
        await closePg(adminConn2);
    }
}

export async function withNewEmptyDb<A>(adminUrl: string, action: (connUrl: string) => Promise<A>): Promise<A> {
    const newDbName = await createTestDb(adminUrl);
    try {
        const connUrl = connReplaceDbName(adminUrl, newDbName);

        return await action(connUrl);
    } finally {
        await destroyTestDb(adminUrl, newDbName);
    }
}

export async function databaseExists(conn: pg.Client, dbName: string): Promise<boolean> {
    const rows = await conn.query("SELECT 1 FROM pg_database WHERE datname=$1", [dbName]);

    return rows.rowCount > 0;
}

export async function createBlankDatabase(conn: pg.Client, dbName: string): Promise<void> {
    await conn.query(`CREATE DATABASE ${dbName} WITH TEMPLATE template0`);
}

async function cloneDatabase(conn: pg.Client, source: string, newName: string): Promise<void> {
    await conn.query(`CREATE DATABASE ${newName} WITH TEMPLATE ${source}`);
}

async function renameDatabase(conn: pg.Client, oldName: string, newName: string): Promise<void> {
    await conn.query(`ALTER DATABASE ${oldName} RENAME TO ${newName}`);
}

export async function dropDatabase(conn: pg.Client, dbName: string): Promise<void> {
    await conn.query(
        `
        SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = '${dbName}'
        `);

    await conn.query(`DROP DATABASE IF EXISTS ${dbName}`);
}

export async function withNewEmptyDbConn<A>(adminUrl: string, action: (conn: pg.Client) => Promise<A>): Promise<A> {
    return withNewEmptyDb(adminUrl, async (connUrl: string) => {
        const conn = await connectPg(connUrl);
        try {
            return await action(conn);
        } finally {
            await closePg(conn);
        }
    });
}

export function readdirAsync(dir: string): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
        fs.readdir(dir, (err, files) => {
            if (<any>err) {
                reject(err);
                return;
            }

            resolve(files);
        });
    });
}

function calcFileHash(filename: string, hashAlgorithm: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const shasum = crypto.createHash(hashAlgorithm);
        try {
            const s = fs.createReadStream(filename, { encoding: "utf8" });
            s.on("data", (data) => {
                shasum.update(data);
            });
            s.on("error", (err) => {
                reject(err);
            });
            s.on("end", () => {
                const hash = shasum.digest("hex");
                resolve(hash);
            });
        } catch (error) {
            reject("calc fail");
        }
    });
}

function tmpDatabaseName(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        crypto.randomBytes(16, (err, buf) => {
            if (<boolean>(<any>err)) {
                reject(err);
                return;
            }

            const dbName = "medflyt_tmp_" + buf.toString("hex");
            resolve(dbName);
        });
    });
}

export function testDatabaseName(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        crypto.randomBytes(16, (err, buf) => {
            if (<boolean>(<any>err)) {
                reject(err);
                return;
            }

            const dbName = "medflyt_test_" + buf.toString("hex");
            resolve(dbName);
        });
    });
}

// async function main() {
//     const connOptions: PostgresConnOptions = {
//         url: "postgres://medflyt:password@localhost:5432/medflyt_props_test1",
//     };

//     await withNewEmptyDbConn(connOptions, async conn => {
//         const rows = await db.any(conn,
//             `
//             SELECT 1;
//             `, []);
//         console.log(rows);
//     });
// }

// // tslint:disable-next-line:no-floating-promises
// main();
