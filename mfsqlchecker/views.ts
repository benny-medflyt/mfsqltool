import { assertNever } from "assert-never";
import * as crypto from "crypto";
import * as path from "path";
import * as ts from "typescript";
import { identifierImportedFrom, isIdentifierFromModule, ModuleId } from "./ts_extra";

function calcViewName(varName: string | null, query: string) {
    const hash = crypto.createHash("sha1").update(query).digest("hex");

    const viewName = varName !== null
        ? "view_" + varName.split(/(?=[A-Z])/).join("_").toLowerCase() + "_" + hash.slice(0, 12)
        : "view_" + hash.slice(0, 12);

    return viewName;
}

export function resolveViewIdentifier(projectDir: string, sourceFile: ts.SourceFile, ident: ts.Identifier): QualifiedSqlViewName {
    const importedFromModule = identifierImportedFrom(sourceFile, ident);
    if (importedFromModule !== null) {
        return QualifiedSqlViewName.create(importedModuleName(projectDir, sourceFile, importedFromModule), ident.text);
    } else {
        // TODO Validate that the referenced view was actually
        // defined in the current file. For now we just assume that
        // it was
        return QualifiedSqlViewName.create(sourceFileModuleName(projectDir, sourceFile), ident.text);
    }
}

export class SqlViewDefinition {
    static parseFromTemplateExpression(projectDir: string, sourceFile: ts.SourceFile, varName: string | null, node: ts.TemplateLiteral): SqlViewDefinition {
        if (ts.isNoSubstitutionTemplateLiteral(node)) {
            return new SqlViewDefinition(sourceFile.fileName, varName, [{ type: "StringFragment", text: node.text }]);
        } else if (ts.isTemplateExpression(node)) {
            const fragments: SqlViewDefinition.Fragment[] = [];
            fragments.push({ type: "StringFragment", text: node.head.text });

            for (const span of node.templateSpans) {
                if (!ts.isIdentifier(span.expression)) {
                    throw new ValidationError(sourceFile, span, "defineSqlView template spans can only be identifiers (no other expressions allowed)");
                }

                const qualifiedSqlViewName = resolveViewIdentifier(projectDir, sourceFile, span.expression);
                fragments.push({ type: "ViewReference", qualifiedSqlViewName: qualifiedSqlViewName });

                fragments.push({ type: "StringFragment", text: span.literal.text });
            }

            return new SqlViewDefinition(sourceFile.fileName, varName, fragments);
        } else {
            return assertNever(node);
        }
    }

    isFullyResolved(): boolean {
        for (const frag of this.fragments) {
            if (frag.type === "ViewReference") {
                return false;
            }
        }

        return true;
    }

    /**
     * Only call this if `isFullyResolved` returns true
     */
    fullyResolvedQuery(): string {
        let result: string = "";
        for (const frag of this.fragments) {
            if (frag.type === "ViewReference") {
                throw new Error("SqlViewDefinition is not fully resolved");
            }
            result += frag.text;
        }
        return result;
    }

    getDependencies(): QualifiedSqlViewName[] {
        return this.dependencies;
    }

    inject(dependency: QualifiedSqlViewName, viewName: string): void {
        for (let i = 0; i < this.fragments.length; ++i) {
            const frag = this.fragments[i];
            if (frag.type === "ViewReference" && frag.qualifiedSqlViewName === dependency) {
                this.fragments[i] = { type: "StringFragment", text: "\"" + viewName + "\"" };
            }
        }
    }

    /**
     * Only call this if `isFullyResolved` returns true
     */
    getName(): string {
        if (this.viewName === null) {
            this.viewName = calcViewName(this.varName, this.fullyResolvedQuery());
        }

        return this.viewName;
    }

    getFileName(): string {
        return this.fileName;
    }

    /**
     * Call this if any of the dependencies have changed
     */
    resetToInitialFragments(): void {
        this.viewName = null;
        this.fragments = [...this.initialFragments];
    }

    isEqual(other: SqlViewDefinition): boolean {
        if (this.initialFragments.length !== other.initialFragments.length) {
            return false;
        }

        for (let i = 0; i < this.initialFragments.length; ++i) {
            if (!SqlViewDefinition.fragmentsEqual(this.initialFragments[i], other.initialFragments[i])) {
                return false;
            }
        }

        return true;
    }

    debugDump(): string {
        return `${this.varName} ${JSON.stringify(this.dependencies)} ${JSON.stringify(this.fragments)}`;
    }

    private constructor(fileName: string, varName: string | null, fragments: SqlViewDefinition.Fragment[]) {
        this.fileName = fileName;
        this.varName = varName;
        this.initialFragments = fragments;
        this.fragments = [...fragments];
        this.dependencies = [];
        for (let i = 0; i < fragments.length; ++i) {
            const frag = this.fragments[i];
            if (frag.type === "ViewReference") {
                this.dependencies.push(frag.qualifiedSqlViewName);
            }
        }
    }

    private readonly fileName: string;
    private readonly varName: string | null;
    private readonly initialFragments: SqlViewDefinition.Fragment[];
    private readonly dependencies: QualifiedSqlViewName[];

    // Mutable
    private fragments: SqlViewDefinition.Fragment[];
    private viewName: string | null = null;

    static fragmentsEqual(lhs: SqlViewDefinition.Fragment, rhs: SqlViewDefinition.Fragment): boolean {
        switch (lhs.type) {
            case "StringFragment":
                return rhs.type === "StringFragment" && lhs.text === rhs.text;
            case "ViewReference":
                return rhs.type === "ViewReference" && lhs.qualifiedSqlViewName === rhs.qualifiedSqlViewName;
            default:
                return assertNever(lhs);
        }
    }
}

namespace SqlViewDefinition {
    export type Fragment
        = { readonly type: "StringFragment"; readonly text: string }
        | { readonly type: "ViewReference"; readonly qualifiedSqlViewName: QualifiedSqlViewName };
}

export interface SqlCreateView {
    readonly qualifiedViewname: QualifiedSqlViewName;
    readonly viewName: string;
    readonly createQuery: string;
    readonly fileName: string;
}

function fullyResolveSqlViewDefinition(v: SqlViewDefinition, myName: QualifiedSqlViewName, library: Map<QualifiedSqlViewName, SqlViewDefinition>): void {
    console.log("fullyResolveSqlViewDefinition", myName);
    if (v.isFullyResolved()) {
        return;
    }

    for (const depName of v.getDependencies()) {
        // Make sure we don't get stuck in infinite recursion!
        if (depName === myName) {
            throw new Error(`View depends on itself: ${myName}`);
        }

        const dep = library.get(depName);
        if (dep === undefined) {
            throw new Error(`Missing dependency in view ${myName}: ${depName}`);
        }
        if (!dep.isFullyResolved()) {
            fullyResolveSqlViewDefinition(dep, depName, library);
        }
        v.inject(depName, dep.getName());
    }
}

export function resolveAllViewDefinitions(library: Map<QualifiedSqlViewName, SqlViewDefinition>): SqlCreateView[] {
    // Fully resolve all of the views (using the above recursive algorithm)

    library.forEach((value, key) => {
        fullyResolveSqlViewDefinition(value, key, library);
    });

    // Topological sort of the views, so that they are created in
    // reverse-dependency order (otherwise we will get an error if we try to
    // create a view before its dependencies have been created)

    const result: SqlCreateView[] = [];
    const added = new Set<QualifiedSqlViewName>();

    function addView(name: QualifiedSqlViewName, view: SqlViewDefinition) {
        if (added.has(name)) {
            return;
        }

        for (const depName of view.getDependencies()) {
            const dep = library.get(depName);
            if (dep === undefined) {
                // This should never happen, because the dependencies were
                // already correctly resolved in the previous step
                throw new Error(`The Impossible happened: Missing dependency in view ${name}: ${depName}`);
            }

            addView(depName, dep);
        }

        result.push({
            qualifiedViewname: name,
            viewName: view.getName(),
            createQuery: view.fullyResolvedQuery(),
            fileName: view.getFileName()
        });
        added.add(name);
    }

    library.forEach((value, key) => {
        addView(key, value);
    });

    // Sanity check
    if (result.length !== library.size) {
        throw new Error(`The Impossible Happened: ${result.length} != ${library.size}`);
    }

    return result;
}

/**
 * Pair of ModuleId + string
 */
export class QualifiedSqlViewName {
    static create(moduleId: ModuleId, viewName: string): QualifiedSqlViewName {
        return (moduleId + " " + viewName) as any;
    }

    static moduleId(val: QualifiedSqlViewName): ModuleId {
        return (val as any).split(" ")[0];
    }

    static viewName(val: QualifiedSqlViewName): string {
        return (val as any).split(" ")[1];
    }

    protected _dummy: QualifiedSqlViewName[];
}

export class ValidationError extends Error {
    constructor(sourceFile: ts.SourceFile, node: ts.Node, public readonly message: string) {
        super(message);

        this.filename = sourceFile.fileName;
        this.loc = ts.getLineAndCharacterOfPosition(sourceFile, node.pos);
    }

    public readonly filename: string;
    public readonly loc: ts.LineAndCharacter;
}

export function sourceFileModuleName(projectDir: string, sourceFile: ts.SourceFile): ModuleId {
    const relFile = path.relative(projectDir, sourceFile.fileName);

    // Strip the ".ts" extension (TODO This should be done more robustly)
    const modName = relFile.slice(0, -3);
    return ModuleId.wrap(modName);
}

function importedModuleName(projectDir: string, sourceFile: ts.SourceFile, importedModule: string): ModuleId {
    return ModuleId.wrap(path.join(path.dirname(ModuleId.unwrap(sourceFileModuleName(projectDir, sourceFile))), importedModule));
}

export function sqlViewsLibraryAddFromSourceFile(projectDir: string, sourceFile: ts.SourceFile): Map<QualifiedSqlViewName, SqlViewDefinition> {
    const viewLibrary = new Map<QualifiedSqlViewName, SqlViewDefinition>();

    function visit(sf: ts.SourceFile, node: ts.Node) {
        if (ts.isVariableStatement(node)) {
            console.log("FOUND VARIABLE STMT");
            for (const decl of node.declarationList.declarations) {
                if (decl.initializer !== undefined) {
                    if (ts.isTaggedTemplateExpression(decl.initializer)) {
                        console.log("FOUND TEMPLATE");
                        if (ts.isIdentifier(decl.initializer.tag) && isIdentifierFromModule(decl.initializer.tag, "defineSqlView", "./lib/sql_linter")) {
                            if (!ts.isIdentifier(decl.name)) {
                                throw new ValidationError(sf, decl.name, "defineSqlView not assigned to a variable");
                            }
                            // tslint:disable-next-line:no-bitwise
                            if ((node.declarationList.flags & ts.NodeFlags.Const) === 0) {
                                throw new ValidationError(sf, decl.name, "defineSqlView assigned to a non-const variable");
                            }
                            const viewName = decl.name.text;
                            const qualifiedSqlViewName = QualifiedSqlViewName.create(sourceFileModuleName(projectDir, sf), viewName);
                            console.log("viewName", viewName, qualifiedSqlViewName);
                            const sqlViewDefinition = SqlViewDefinition.parseFromTemplateExpression(projectDir, sf, viewName, decl.initializer.template);
                            viewLibrary.set(qualifiedSqlViewName, sqlViewDefinition);
                        }
                    }
                }
            }
        }
    }

    ts.forEachChild(sourceFile, (node: ts.Node) => visit(sourceFile, node));

    return viewLibrary;
}

export function sqlViewLibraryResetToInitialFragmentsIncludingDeps(viewName: QualifiedSqlViewName, viewLibrary: Map<QualifiedSqlViewName, SqlViewDefinition>): void {
    const view = viewLibrary.get(viewName);
    if (view !== undefined) {
        view.resetToInitialFragments();
        viewLibrary.forEach((value, key) => {
            if (value.getDependencies().indexOf(viewName) >= 0) {
                // Make sure we don't get stuck in infinite recursion!
                if (key !== viewName) {
                    sqlViewLibraryResetToInitialFragmentsIncludingDeps(key, viewLibrary);
                }
            }
        });
    }
}

/*
export function sqlViewsLibraryClearModule(viewLibrary: Map<QualifiedSqlViewName, SqlViewDefinition>, moduleId: string): void {
    for (const qname of viewLibrary.keys()) {
        if (QualifiedSqlViewName.moduleId(qname) === moduleId) {
            viewLibrary.delete(qname);
        }
    }
}
*/
