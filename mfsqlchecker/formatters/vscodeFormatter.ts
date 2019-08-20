import { assertNever } from "assert-never";
import * as path from "path";
import { ErrorDiagnostic, SrcSpan } from "../ErrorDiagnostic";

export function vscodeFormatter(errorDiagnostic: ErrorDiagnostic): string {
    let result = "";

    const loc = vscodeLocation(errorDiagnostic.span);

    const filename = path.relative(process.cwd(), errorDiagnostic.fileName);

    let severity = "error";
    function addLine(msg: string) {
        result += "[DIAGNOSTIC] " + filename + " (" + severity + ") " + loc + " " + msg + "\n";
        severity = "error";
    }

    for (const message of errorDiagnostic.messages) {
        for (const line of message.split("\n")) {
            addLine(line);
        }
    }
    if (errorDiagnostic.epilogue !== null) {
        for (const line of errorDiagnostic.epilogue.split("\n")) {
            addLine(line);
        }
    }

    return result;
}

function vscodeLocation(span: SrcSpan): string {
    switch (span.type) {
        case "LineAndColRange":
            return "(" + span.startLine + "," + span.startCol + "," + span.endLine + "," + span.endCol + ")";
        case "LineAndCol":
            return "(" + span.line + "," + span.col + ")";
        case "File":
            return "(1)";
        default:
            return assertNever(span);
    }
}
