import "source-map-support/register"; // tslint:disable-line:no-import-side-effect

import * as ts from "typescript";
import { DbConnector } from "./DbConnector";
import { ErrorDiagnostic } from "./ErrorDiagnostic";
import { findAllQueryCalls, QueryCallExpression, resolveQueryFragment } from "./queries";
import { QualifiedSqlViewName, resolveAllViewDefinitions, sourceFileModuleName, SqlViewDefinition, sqlViewLibraryResetToInitialFragmentsIncludingDeps, sqlViewsLibraryAddFromSourceFile } from "./views";

export class SqlCheckerEngine {
    constructor(private readonly dbConnector: DbConnector, private readonly formatter: (errorDiagnostic: ErrorDiagnostic) => string) {
        // TODO ...
        this.viewLibrary = new Map<QualifiedSqlViewName, SqlViewDefinition>();
    }

    viewLibrary: Map<QualifiedSqlViewName, SqlViewDefinition>;

    // TODO return list of errors
    checkChangedSourceFiles(projectDir: string, program: ts.Program, checker: ts.TypeChecker, sourceFiles: ts.SourceFile[]): void {
        console.log("checkChangedSourceFiles");

        const before = new Date();
        console.log("[DIAGNOSTICS START]");

        for (const sourceFile of sourceFiles) {
            const views = sqlViewsLibraryAddFromSourceFile(projectDir, sourceFile);
            for (const key of this.viewLibrary.keys()) {
                if (QualifiedSqlViewName.moduleId(key) === sourceFileModuleName(projectDir, sourceFile)) {
                    const newView = views.get(key);
                    if (newView === undefined) {
                        this.viewLibrary.delete(key);
                    } else {
                        const oldView = this.viewLibrary.get(key);
                        if (oldView === undefined) {
                            throw new Error("The Impossible Happened");
                        }
                        if (!oldView.isEqual(newView)) {
                            this.viewLibrary.set(key, newView);
                            sqlViewLibraryResetToInitialFragmentsIncludingDeps(key, this.viewLibrary);
                        }
                    }
                }
            }
            views.forEach((value, key) => {
                if (!this.viewLibrary.has(key)) {
                    this.viewLibrary.set(key, value);
                }
            });
        }

        const sqlViews = resolveAllViewDefinitions(this.viewLibrary);

        console.log("TIME:", new Date().getTime() - before.getTime());

        const progSourceFiles = program.getSourceFiles().filter(s => !s.isDeclarationFile);

        let queries: QueryCallExpression[] = [];
        for (const sourceFile of progSourceFiles) {
            queries = queries.concat(findAllQueryCalls(checker, sourceFile));
        }

        const lookupViewName = (qualifiedSqlViewName: QualifiedSqlViewName): string | undefined => {
            const v = this.viewLibrary.get(qualifiedSqlViewName);
            if (v === undefined) {
                return undefined;
            }
            return v.getName();
        };

        const resolvedQueries = queries.map(q => resolveQueryFragment(projectDir, checker, q, lookupViewName));

        // console.log(resolvedQueries);

        this.dbConnector.validateManifest({
            queries: resolvedQueries,
            viewLibrary: sqlViews
        }).then(errors => {
            for (const error of errors) {
                console.log(this.formatter(error));
            }
            console.log("[DIAGNOSTICS END]");
        });

        // const progSourceFiles = program.getSourceFiles().filter(s => !s.isDeclarationFile);

        // let queries: QueryCallExpression[] = [];
        // for (const sourceFile of progSourceFiles) {
        //     queries = queries.concat(findAllQueryCalls(sourceFile));
        // }

        // console.log("queries", queries);

        // this.dbConnector.validateManifest({
        //     queries: [queries[0].queryFragments[0].text],
        //     viewLibrary: null
        // });
    }
}

// function processQuery(checker: ts.TypeChecker, query: QueryCallExpression): void {
//     console.log("PROCESS QUERY");
//     console.log(query.typeArgument);
//     for (const frag of query.queryFragments) {
//         switch (frag.type) {
//             case "StringFragment":
//                 break;
//             case "Expression":
//                 const t = checker.getTypeAtLocation(frag.exp);
//                 console.log(t);
//                 break;
//             default:
//                 assertNever(frag);
//         }
//     }
//     console.log("DONE");
// }

// export function checkAllSqlQueries(checker: ts.TypeChecker, sourceFiles: ReadonlyArray<ts.SourceFile>) {
//     function visit(node: ts.Node) {
//         if (ts.isCallExpression(node)) {
//             if (ts.isIdentifier(node.expression)) {
//                 if (isIdentifierFromModule(node.expression, "query", "./lib/sql_linter")) {
//                     const query = buildQueryCallExpression(node);
//                     if (query !== null) {
//                         processQuery(checker, query);
//                     }
//                     // console.log("QUERY", node.arguments.length);
//                     // console.log(checker.getTypeAtLocation(node.typeArguments![0]).symbol);
//                     // console.log(checker.getTypeAtLocation(node.arguments[1]));
//                     // // console.log(checker.symbolToEntityName(checker.getSymbolAtLocation(node.arguments[0]), ts.SymbolFlags.None));
//                     // // console.log(checker.symbolToEntityName(checker.getSymbolAtLocation(node.arguments[1]), ts.SymbolFlags.None));
//                 }
//             }
//         }

//         ts.forEachChild(node, visit);
//     }

//     for (const sourceFile of sourceFiles) {
//         console.log("sourceFile", sourceFile.fileName);
//         ts.forEachChild(sourceFile, visit);
//     }
// }



export class TypeScriptWatcher {
    constructor(observer: SqlCheckerEngine) {
        this.observer = observer;
    }

    private readonly observer: SqlCheckerEngine;

    private changedSourceFiles: string[] = [];

    createProgram = (rootNames: ReadonlyArray<string> | undefined, options: ts.CompilerOptions | undefined, host?: ts.CompilerHost, oldProgram?: ts.EmitAndSemanticDiagnosticsBuilderProgram, configFileParsingDiagnostics?: ReadonlyArray<ts.Diagnostic>, projectReferences?: ReadonlyArray<ts.ProjectReference> | undefined): ts.EmitAndSemanticDiagnosticsBuilderProgram => {
        const b = ts.createEmitAndSemanticDiagnosticsBuilderProgram(rootNames, options, host, oldProgram, configFileParsingDiagnostics, projectReferences);

        // tslint:disable-next-line:no-unbound-method
        const origEmit = b.emit;
        b.emit = (targetSourceFile?: ts.SourceFile, writeFile?: ts.WriteFileCallback, cancellationToken?: ts.CancellationToken, emitOnlyDtsFiles?: boolean, customTransformers?: ts.CustomTransformers): ts.EmitResult => {
            console.log("emit", targetSourceFile, writeFile);
            const writeFile2 = (fileName: string, data: string, writeByteOrderMark: boolean, onError?: (message: string) => void, sourceFiles?: ReadonlyArray<ts.SourceFile>): void => {
                console.log("writeFile", fileName, data.length, writeByteOrderMark);
                if (writeFile !== undefined) {
                    writeFile(fileName, data, writeByteOrderMark, onError, sourceFiles);
                }
            };
            const result = origEmit(targetSourceFile, writeFile2, cancellationToken, emitOnlyDtsFiles, customTransformers);
            const changedFiles: string[] = (<any>result).sourceMaps.map((s: any) => s.inputSourceFileNames);
            for (const changedFile of changedFiles) {
                // console.log("changedFile", changedFile, sourceFilenameModuleName(projectDirAbs, changedFile[0]));
                this.changedSourceFiles.push(changedFile[0]);
            }
            console.log("emit result", changedFiles);
            return result;
        };

        // tslint:disable-next-line:no-unbound-method
        const origEmitNextAffectedFile = b.emitNextAffectedFile;
        b.emitNextAffectedFile = (writeFile?: ts.WriteFileCallback, cancellationToken?: ts.CancellationToken, emitOnlyDtsFiles?: boolean, customTransformers?: ts.CustomTransformers): ts.AffectedFileResult<ts.EmitResult> => {
            console.log("emitNextAffectedFile");
            const result = origEmitNextAffectedFile(writeFile, cancellationToken, emitOnlyDtsFiles, customTransformers);
            console.log("emitNextAffectedFile result", result);
            return result;
        };
        return b;
    }

    projectDir: string;

    run(projectDir: string): void {
        this.projectDir = projectDir;

        const configPath = ts.findConfigFile(
            /*searchPath*/ projectDir,
            ts.sys.fileExists, // tslint:disable-line:no-unbound-method
            "tsconfig.json"
        );

        if (configPath === undefined) {
            throw new Error("Could not find a valid 'tsconfig.json'.");
        }

        const host = ts.createWatchCompilerHost(
            configPath,
            {
                // noEmit: true
                // noEmitOnError: false
            },
            ts.sys,
            this.createProgram,
            this.reportDiagnostic,
            this.reportWatchStatusChanged
        );

        if (host.afterProgramCreate === undefined) {
            throw new Error("host.afterProgramCreate is undefined");
        }

        // tslint:disable-next-line:no-unbound-method
        const origPostProgramCreate = host.afterProgramCreate;

        host.afterProgramCreate = program => {
            console.log("** We finished making the program! **");
            this.builderProgram = program;
            origPostProgramCreate(program);
        };

        // `createWatchProgram` creates an initial program, watches files, and updates
        // the program over time.
        ts.createWatchProgram(host);
    }

    private builderProgram: ts.BuilderProgram | null = null;

    reportDiagnostic = (_diagnostic: ts.Diagnostic): void => {
        console.info("reportDiagnosstic");
    }

    reportWatchStatusChanged = (diagnostic: ts.Diagnostic, _newLine: string, _options: ts.CompilerOptions): void => {
        console.info("reportWatchStatusChanged", JSON.stringify(diagnostic));
        if (diagnostic.code === 6193 || diagnostic.code === 6194) {
            if (this.builderProgram === null) {
                throw new Error(`builderProgram not ready`);
            }

            const program = this.builderProgram.getProgram();
            const progSourceFiles = program.getSourceFiles().filter(s => !s.isDeclarationFile);

            const foundSourceFiles: ts.SourceFile[] = [];
            for (const sourceFile of progSourceFiles) {
                // console.log("sourceFileName", sourceFile.fileName);
                if (this.changedSourceFiles.indexOf(sourceFile.fileName) >= 0) {
                    foundSourceFiles.push(sourceFile);
                }
            }

            this.afterChange(program, foundSourceFiles);
            this.changedSourceFiles = [];
        }
        // console.info("INFO", JSON.stringify(diagnostic), ts.formatDiagnostic(diagnostic, formatHost));
    }

    afterChange = (program: ts.Program, sourceFiles: ts.SourceFile[]): void => {
        console.log("AFTER CHANGE", sourceFiles.map(s => s.fileName));

        this.observer.checkChangedSourceFiles(this.projectDir, program, program.getTypeChecker(), sourceFiles);
    }
}

// const formatHost: ts.FormatDiagnosticsHost = {
//     getCanonicalFileName: path => path,
//     getCurrentDirectory: ts.sys.getCurrentDirectory,
//     getNewLine: () => ts.sys.newLine
// };

// function reportDiagnostic(diagnostic: ts.Diagnostic) {
//     console.error(
//         "DIAG ERROR",
//         diagnostic.code,
//         ":",
//         ts.flattenDiagnosticMessageText(
//             diagnostic.messageText,
//             formatHost.getNewLine()
//         )
//     );
// }

/*
async function main() {
    console.log("connecting...");
    const dbConnector = await DbConnector.Connect("migrations", "postgres://test:test@localhost:6432/test", "sql_checker_db");
    console.log("connected");
    const e = new SqlCheckerEngine(dbConnector);
    const w = new TypeScriptWatcher(e);
    w.run("./demo");
}

main();
*/
