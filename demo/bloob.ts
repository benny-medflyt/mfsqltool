import { Connection, Req, Opt, sql } from "./lib/mfsqltool";

export async function bloob() {
    const conn: Connection = null as any;

    const rows = await conn.query<{
        fname: Req<string>,
        lname: Req<string>,
        phonenumber: Opt<string>,
        salary: Req<number>,
        manager_id: Opt<number>,
        managername: Req<string>
    }
    >(sql
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


    await conn.query<{
        id: Req<number>,
        customer_id: Req<number>,
        employee_id: Req<number>,
        model: Req<string>,
        status: Req<string>,
        total_cost: Req<number>
    }
    >(sql
        ` SELECT * FROM car
        `);


    console.log(rows[0].salary);
}
