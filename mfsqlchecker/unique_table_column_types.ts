import { Either } from "./either";
import { ErrorDiagnostic } from "./ErrorDiagnostic";
import { SqlType, TypeScriptType } from "./queries";

export interface UniqueTableColumnType {
    typeScriptTypeName: TypeScriptType;
    tableName: string;
    columnName: string;
}

export function sqlUniqueTypeName(tableName: string, columnName: string): string {
    return tableName + "(" + columnName + ")";
}

export function makeUniqueColumnTypes(uniqueTableColumnTypes: UniqueTableColumnType[]): Map<SqlType, TypeScriptType> {
    const result = new Map<SqlType, TypeScriptType>();

    for (const uniqueTableColumnType of uniqueTableColumnTypes) {
        const sqlTypeName = sqlUniqueTypeName(uniqueTableColumnType.tableName, uniqueTableColumnType.columnName);
        result.set(SqlType.wrap(sqlTypeName), uniqueTableColumnType.typeScriptTypeName);
    }

    return result;
}

// TODO !!!!!!!!!
// Change this to something like
//     {
//         "uniqueTableColumnTypes": [ ... ],
//         "": [
//             {
//                 "typeScriptTypeName": "Instant",
//                 "sqlTypeName": "timestamptz"
//             },
//             {
//                 "typeScriptTypeName": "LocalDateTime",
//                 "sqlTypeName": "timestamp"
//             },
//             {
//                 "typeScriptTypeName": "LocalDate",
//                 "sqlTypeName": "date"
//             },
//             {
//                 "typeScriptTypeName": "LocalTime",
//                 "sqlTypeName": "time"
//             }
//         ]
//     }
// TODO !!!!!!!!!
export function parseUniqueTableColumnTypeFile(fileName: string, fileContents: string): Either<ErrorDiagnostic, UniqueTableColumnType[]> {
    function error<T>(messages: string[]): Either<ErrorDiagnostic, T> {
        return {
            type: "Left", value: {
                fileContents: fileContents,
                fileName: fileName,
                span: {
                    type: "File"
                },
                messages: messages,
                epilogue: null
            }
        };
    }

    let json: unknown;
    try {
        json = JSON.parse(fileContents);
    } catch (err) {
        return error(["JSON Parser Error", err.message]);
    }


    if (!Array.isArray(json)) {
        return error(["Root JSON object must be an array"]);
    }

    const result: UniqueTableColumnType[] = [];

    for (let i = 0; i < json.length; ++i) {
        const elem = json[i];
        const typeScriptTypeName = elem["typeScriptTypeName"];
        const tableName = elem["tableName"];
        const columnName = elem["columnName"];

        if (typeof typeScriptTypeName !== "string" || typeScriptTypeName === "") {
            return error([`Object at index ${i}: property "typeScriptTypeName" missing or not a string`]);
        }
        if (typeof tableName !== "string" || tableName === "") {
            return error([`Object at index ${i}: "tableName" missing or not a string`]);
        }
        if (typeof columnName !== "string" || columnName === "") {
            return error([`Object at index ${i}: "columnName" missing or not a string`]);
        }

        result.push({
            typeScriptTypeName: TypeScriptType.wrap(typeScriptTypeName),
            tableName: tableName,
            columnName: columnName
        });
    }

    return {
        type: "Right",
        value: result
    };
}
