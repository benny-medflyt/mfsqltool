// import "source-map-support/register";
// import * as ts from "typescript";
// // import * as fs from "fs";
// import * as path from "path";

// interface DocEntry {
//     name?: string;
//     fileName?: string;
//     documentation?: string;
//     type?: string;
//     constructors?: DocEntry[];
//     parameters?: DocEntry[];
//     returnType?: string;
// }

// /** Generate documentation for all classes in a set of .ts files */
// function generateDocumentation(
//     fileNames: string[],
//     options: ts.CompilerOptions
// ): void {
//     // Build a program using the set of root file names in fileNames
//     let program = ts.createProgram(fileNames, options);

//     // Get the checker, we will use it to find more about classes
//     let checker = program.getTypeChecker();

//     const progSourceFiles = program.getSourceFiles().filter(s => !s.isDeclarationFile);

//     const library = buildSqlViewsLibrary(progSourceFiles);

//     console.log("LIBRARY");
//     console.log("-------");
//     library.forEach((value, key) => {
//         console.log(key, value.debugDump());
//     });
//     console.log("-------");

//     for (const x of resolveAllViewDefinitions(library)) {
//         console.log(x.viewName, ":", x.createQuery);
//     }

//     checkAllSqlQueries(checker, progSourceFiles);

//     return;


//     let output: DocEntry[] = [];

//     // Visit every sourceFile in the program
//     for (const sourceFile of program.getSourceFiles()) {
//         if (!sourceFile.isDeclarationFile) {
//             // Walk the tree to search for classes
//             ts.forEachChild(sourceFile, visit);
//         }
//     }

//     // print out the doc
//     fs.writeFileSync("classes.json", JSON.stringify(output, undefined, 4));

//     return;

//     /** visit nodes finding exported classes */
//     function visit(node: ts.Node) {
//         if (ts.isTaggedTemplateExpression(node)) {
//             if (ts.isTemplateExpression(node.template)) {
//                 visitTemplateExpression(checker, node.template);
//             } else if (ts.isNoSubstitutionTemplateLiteral(node.template)) {
//                 console.log("** TMPL **");
//                 console.log(node.template.text);
//             }
//             // ts.forEachChild(node, n => {
//             //     console.log(n.kind, n.getText());
//             //     if (ts.isTemplateExpression(n)) {
//             //         console.log("templateSpans", n.templateSpans);
//             //     }
//             // });
//             // if (ts.isIdentifier(node.tag)) {
//             //     console.log(node.tag.text);
//             //     console.log(checker.getSymbolAtLocation(node.tag));
//             // }

//             // process.exit(0);
//             // console.log("FOUND!");
//             // if (ts.isTemplateExpression(node.template)) {
//             //     for (const span of node.template.templateSpans) {
//             //         console.log("SPAN");
//             //         console.log(span.expression);
//             //         console.log("TYPE:", checker.typeToString(checker.getTypeAtLocation(span.expression)));
//             //     }
//             // }
//         }

//         ts.forEachChild(node, visit);
//     }

//     /** Serialize a symbol into a json object */
//     function serializeSymbol(symbol: ts.Symbol): DocEntry {
//         return {
//             name: symbol.getName(),
//             type: checker.typeToString(
//                 checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration!)
//             )
//         };
//     }

//     /** Serialize a class symbol information */
//     function serializeClass(symbol: ts.Symbol) {
//         let details = serializeSymbol(symbol);

//         // Get the construct signatures
//         let constructorType = checker.getTypeOfSymbolAtLocation(
//             symbol,
//             symbol.valueDeclaration!
//         );
//         details.constructors = constructorType
//             .getConstructSignatures()
//             .map(serializeSignature);
//         return details;
//     }

//     /** Serialize a signature (call or construct) */
//     function serializeSignature(signature: ts.Signature) {
//         return {
//             parameters: signature.parameters.map(serializeSymbol),
//             returnType: checker.typeToString(signature.getReturnType())
//         };
//     }

//     /** True if this is visible outside this file, false otherwise */
//     function isNodeExported(node: ts.Node): boolean {
//         return (
//             (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0 ||
//             (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile)
//         );
//     }
// }





// export function checkAllSqlQueries(checker: ts.TypeChecker, sourceFiles: ReadonlyArray<ts.SourceFile>) {
//     function visit(node: ts.Node) {
//         if (ts.isCallExpression(node)) {
//             if (ts.isIdentifier(node.expression)) {
//                 if (isIdentifierFromModule(node.expression, "query", "./lib/sql_checker")) {
//                     console.log("QUERY", node.arguments.length);
//                     console.log(checker.getTypeAtLocation(node.typeArguments![0]));
//                     console.log(checker.getTypeAtLocation(node.arguments[1]));
//                     // console.log(checker.symbolToEntityName(checker.getSymbolAtLocation(node.arguments[0]), ts.SymbolFlags.None));
//                     // console.log(checker.symbolToEntityName(checker.getSymbolAtLocation(node.arguments[1]), ts.SymbolFlags.None));
//                 }
//             }
//         }

//         ts.forEachChild(node, visit);
//     }

//     for (const sourceFile of sourceFiles) {
//         ts.forEachChild(sourceFile, visit);
//     }
// }

// // generateDocumentation(process.argv.slice(2), {
// //     target: ts.ScriptTarget.ES5,
// //     module: ts.ModuleKind.CommonJS
// // });






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

// function reportWatchStatusChanged(diagnostic: ts.Diagnostic, newLine: string, options: ts.CompilerOptions) {
//     console.info("INFO", JSON.stringify(diagnostic), ts.formatDiagnostic(diagnostic, formatHost));
// }

// function main4() {
//     const configPath = ts.findConfigFile(
//         /*searchPath*/ "./demo",
//         ts.sys.fileExists,
//         "tsconfig.json"
//     );

//     if (!configPath) {
//         throw new Error("Could not find a valid 'tsconfig.json'.");
//     }

//     function createProgram(rootNames: ReadonlyArray<string> | undefined, options: ts.CompilerOptions | undefined, host?: ts.CompilerHost, oldProgram?: ts.EmitAndSemanticDiagnosticsBuilderProgram, configFileParsingDiagnostics?: ReadonlyArray<ts.Diagnostic>, projectReferences?: ReadonlyArray<ts.ProjectReference> | undefined): ts.EmitAndSemanticDiagnosticsBuilderProgram {
//         const b = ts.createEmitAndSemanticDiagnosticsBuilderProgram(rootNames, options, host, oldProgram, configFileParsingDiagnostics, projectReferences);

//         const origEmit = b.emit;
//         b.emit = (targetSourceFile?: ts.SourceFile, writeFile?: ts.WriteFileCallback, cancellationToken?: ts.CancellationToken, emitOnlyDtsFiles?: boolean, customTransformers?: ts.CustomTransformers): ts.EmitResult => {
//             console.log("emit", targetSourceFile, writeFile);
//             const writeFile2 = (fileName: string, data: string, writeByteOrderMark: boolean, onError?: (message: string) => void, sourceFiles?: ReadonlyArray<ts.SourceFile>): void => {
//                 console.log("writeFile", fileName, data.length, writeByteOrderMark);
//                 if (writeFile !== undefined) {
//                     writeFile(fileName, data, writeByteOrderMark, onError, sourceFiles);
//                 }
//             };
//             const result = origEmit(targetSourceFile, writeFile2, cancellationToken, emitOnlyDtsFiles, customTransformers);
//             console.log("emit result", result.sourceMaps.map(s => s.inputSourceFileNames));
//             return result;
//         };

//         const origEmitNextAffectedFile = b.emitNextAffectedFile;
//         b.emitNextAffectedFile = (writeFile?: ts.WriteFileCallback, cancellationToken?: ts.CancellationToken, emitOnlyDtsFiles?: boolean, customTransformers?: ts.CustomTransformers): ts.AffectedFileResult<ts.EmitResult> => {
//             console.log("emitNextAffectedFile");
//             const result = origEmitNextAffectedFile(writeFile, cancellationToken, emitOnlyDtsFiles, customTransformers);
//             console.log("emitNextAffectedFile result", result);
//             return result;
//         }
//         return b;
//     }

//     const host = ts.createWatchCompilerHost(
//         configPath,
//         {
//             // noEmit: true
//             // noEmitOnError: false
//         },
//         ts.sys,
//         createProgram,
//         reportDiagnostic,
//         reportWatchStatusChanged
//     );

//     const origPostProgramCreate = host.afterProgramCreate;

//     host.afterProgramCreate = program => {
//         console.log("** We finished making the program! **");
//         origPostProgramCreate!(program);
//     };



//     // `createWatchProgram` creates an initial program, watches files, and updates
//     // the program over time.
//     ts.createWatchProgram(host);
// }

// main4();
