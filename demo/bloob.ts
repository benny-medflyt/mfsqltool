import { query, sql, Connection, Req, Opt } from "./lib/sql_linter";

export async function bloob() {
    const conn: Connection = null as any;

    const rows = await query<{
        fname: Req<string>,
        lname: Req<string>,
        phonenumber: Opt<string>,
        salary: Req<number>,
        manager_id: Opt<number>,
        managername: Req<string>
    }
    >(conn, sql
        `
        SELECT
            employee.fname,
            employee.lname,
            employee.phonenumber,
            employee.salary,
            employee.manager_id,
            e.fname AS managerName
        FROM employee
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
}
