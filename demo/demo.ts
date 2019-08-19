// import { coolView } from "./blah";
import { query, sql, defineSqlView, Connection, Req, Opt } from "./lib/sql_linter";
import { coolView, XXX } from "./helper_views/cool";

const theView = defineSqlView`SELECT 2 AS two`;

const anotherView = defineSqlView`SELECT two FROM ${theView}, ${coolView}`;

function add(x: number, y: number) {
    return x + y;
}

const lastView = defineSqlView`SELECT * FROM ${anotherView}`;

export const oneMore = defineSqlView`SELECT 1, 3 as b`;

interface YYY extends XXX {
    cat: string;
}

function getTheView() {
    return lastView;
}

function strange(): string | null {
    return null;
}

type Blah = "blah" | null;

function blah(): Blah {
    return "blah";
}

const badView = defineSqlView`SELECT 'cool' AS num`;

export async function test() {
    let theId: string | number = 3 + 2;
    theId = "hi";

    const conn: Connection = null as any;

    // const blah: "blah" | null = "blah";

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
