import { TypeScriptType, SqlType } from "./queries";

export interface ConfigFile {
    migrationsDir?: string;
    postgresVersion?: string;
    customSqlTypeMappings?: CustomSqlTypeMapping[];
    uniqueTableColumnTypes?: UniqueTableColumnType[];
}

export interface CustomSqlTypeMapping {
    typeScriptTypeName: TypeScriptType;
    sqlTypeName: SqlType;
}

export interface UniqueTableColumnType {
    typeScriptTypeName: TypeScriptType;
    tableName: string;
    columnName: string;
}
