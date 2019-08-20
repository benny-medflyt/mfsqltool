// import { coolView } from "./blah";
import { query, sql, defineSqlView, Connection, Req, Opt } from "./lib/sql_linter";

export const oneMore = defineSqlView`SELECT 1, 3 as b`;

const employeeName = defineSqlView`SELECT fname AS employee_fname, lname AS lname1 FROM employee WHERE salary > 10`;

const employeeName2 = defineSqlView`SELECT employee_fname AS fname, lname1 AS lname FROM ${employeeName}`;

const badView = defineSqlView`SELECT 'cool' AS num UNION ALL SELECT NULL`;

export async function test() {
    const conn: Connection = null as any;

    // const blah: "blah" | null = "blah";

    await query(conn, sql`
    
    `);

    await query<{
        fname: Req<string>,
        lname: Req<string>
    }>(conn, sql
        `
        SELECT * FROM ${employeeName2}
        `);

    // const rows = await query<{ name: string, age: number }>(conn, sql
    const rows = await query<{
        fname: Req<string>,
        lname: Req<string>,
        phonenumber: Opt<string>,
        salary: Req<number>,
        manager_id: Opt<number>,
        managername: Req<string>,
        badViewNum: Opt<string>
    }>(conn, sql
        `
        SELECT
            employee.fname,
            employee.lname,
            employee.phonenumber,
            employee.salary,
            employee.manager_id,
            e.fname AS managerName,
            ${badView}.num AS "badViewNum"
        FROM
        employee
        INNER JOIN ${badView} ON employee.fname = ${badView}.num
        LEFT JOIN employee e ON employee.manager_id = e.id
        WHERE employee.fname = ${"alice"}
        AND employee.salary = ${5}
        `);


    await query<{
        customer_id: Req<number>,
        id: Req<number>,
        employee_id: Req<number>,
        model: Req<string>,
        status: Req<string>,
        total_cost: Req<number>
    }>(conn, sql
        ` SELECT * FROM car
        `);


    console.log(rows[0].salary);

    // await query(sql
    //     `
    //     SELECT * FROM ${anotherView}
    //     `);
}

test();
