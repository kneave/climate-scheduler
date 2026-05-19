#!/usr/bin/env python3
"""Extract structured codebase model from TypeScript and JavaScript files.

Uses a regex/token-based approach since we can't rely on ts-morph being installed.
Extracts: functions (signatures, calls), classes, methods, properties,
event listeners, state mutations, imports/exports.
"""

import json
import re
import sys
from pathlib import Path
from collections import defaultdict


def extract_ts_imports(source):
    """Extract import statements."""
    imports = []
    # import { X, Y } from './path'
    for m in re.finditer(r'import\s*\{([^}]+)\}\s*from\s*[\'"]([^\'"]+)[\'"]', source):
        names = [n.strip().split(' as ')[0].strip() for n in m.group(1).split(',')]
        imports.extend([f"{m.group(2)}:{n}" for n in names])
    # import X from './path'
    for m in re.finditer(r'import\s+(\w+)\s+from\s+[\'"]([^\'"]+)[\'"]', source):
        imports.append(f"{m.group(2)}:{m.group(1)}")
    # import './path'
    for m in re.finditer(r'import\s+[\'"]([^\'"]+)[\'"]', source):
        imports.append(m.group(1))
    return sorted(set(imports))


def extract_js_imports(source):
    """Extract JS import statements (no TS)."""
    imports = []
    # Same patterns but also handle dynamic imports
    for m in re.finditer(r'import\s*\{([^}]+)\}\s*from\s*[\'"]([^\'"]+)[\'"]', source):
        names = [n.strip().split(' as ')[0].strip() for n in m.group(1).split(',')]
        imports.extend([f"{m.group(2)}:{n}" for n in names])
    for m in re.finditer(r'import\s+(\w+)\s+from\s+[\'"]([^\'"]+)[\'"]', source):
        imports.append(f"{m.group(2)}:{m.group(1)}")
    for m in re.finditer(r'import\s+[\'"]([^\'"]+)[\'"]', source):
        imports.append(m.group(1))
    return sorted(set(imports))


def extract_exports(source):
    """Extract export statements."""
    exports = []
    for m in re.finditer(r'export\s+(?:default\s+)?(?:class|function|const|let|var)\s+(\w+)', source):
        exports.append(m.group(1))
    for m in re.finditer(r'export\s*\{([^}]+)\}', source):
        names = [n.strip().split(' as ')[0].strip() for n in m.group(1).split(',')]
        exports.extend(names)
    return sorted(set(exports))


def extract_classes(source, filepath):
    """Extract class definitions with methods and properties."""
    classes = []
    # Find class declarations
    for m in re.finditer(r'(?:export\s+)?(?:default\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{', source):
        class_name = m.group(1)
        base_class = m.group(2)
        start_line = source[:m.start()].count('\n') + 1

        # Extract class body (simplified: find matching brace)
        brace_start = source.index('{', m.start())
        depth = 0
        class_end = brace_start
        for i in range(brace_start, len(source)):
            if source[i] == '{':
                depth += 1
            elif source[i] == '}':
                depth -= 1
                if depth == 0:
                    class_end = i
                    break
        class_body = source[brace_start:class_end + 1]

        # Extract properties (class field declarations)
        properties = []
        for pm in re.finditer(r'(?:private|protected|public)?\s*(?:readonly\s+)?(\w+)\s*[=:]', class_body):
            if pm.group(1) not in ('constructor', 'function', 'if', 'for', 'while', 'switch'):
                properties.append(pm.group(1))

        # Extract methods
        methods = []
        for mm in re.finditer(
            r'(?:private|protected|public)?\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*\(([^)]*)\)',
            class_body
        ):
            method_name = mm.group(1)
            if method_name in ('constructor', 'if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'typeof'):
                continue
            params = mm.group(2).strip()
            method_line = source[:brace_start + mm.start()].count('\n') + 1
            methods.append({
                "name": method_name,
                "line": method_line,
                "params": params if params else None,
                "is_async": 'async ' in class_body[max(0, mm.start()-20):mm.start()],
            })

        classes.append({
            "name": class_name,
            "line": start_line,
            "base": base_class,
            "properties": sorted(set(properties)),
            "methods": methods,
        })
    return classes


def extract_functions(source, filepath):
    """Extract top-level and exported functions."""
    functions = []
    # Arrow functions assigned to const/let
    for m in re.finditer(r'(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>', source):
        name = m.group(1)
        params = m.group(2).strip()
        line = source[:m.start()].count('\n') + 1
        functions.append({
            "name": name,
            "line": line,
            "params": params if params else None,
            "is_async": 'async ' in m.group(0),
            "type": "arrow",
        })

    # Regular function declarations
    for m in re.finditer(r'(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)', source):
        name = m.group(1)
        params = m.group(2).strip()
        line = source[:m.start()].count('\n') + 1
        functions.append({
            "name": name,
            "line": line,
            "params": params if params else None,
            "is_async": 'async ' in m.group(0),
            "type": "function",
        })

    return functions


def extract_event_listeners(source):
    """Extract addEventListener and custom event dispatch patterns."""
    listeners = []
    # addEventListener calls
    for m in re.finditer(r'\.addEventListener\(\s*[\'"](\w+)[\'"]', source):
        listeners.append({"event": m.group(1), "type": "dom"})

    # dispatchEvent / fire / bus.fire patterns
    for m in re.finditer(r'\.fire\(\s*[\'"](\w+)[\'"]', source):
        listeners.append({"event": m.group(1), "type": "bus"})
    for m in re.finditer(r'dispatchEvent\([^)]*[\'"](\w+)[\'"]', source):
        listeners.append({"event": m.group(1), "type": "custom"})

    # Home Assistant event patterns
    for m in re.finditer(r'hass\.callService\([^,]+,\s*[\'"](\w+)[\'"]', source):
        listeners.append({"service": m.group(1), "type": "ha_service"})

    return listeners


def extract_state_mutations(source):
    """Extract this.X = ... assignments (state mutations in classes)."""
    mutations = set()
    for m in re.finditer(r'this\.(\w+)\s*=', source):
        mutations.add(m.group(1))
    # Also this.X = in the context of property assignments
    for m in re.finditer(r'this\.(\w+)\s*\+=', source):
        mutations.add(m.group(1))
    return sorted(mutations)


def extract_service_calls(source):
    """Extract climate_scheduler service calls from frontend."""
    services = set()
    for m in re.finditer(r'climate_scheduler\.(\w+)', source):
        services.add(m.group(1))
    return sorted(services)


def extract_module_info(filepath, source):
    """Extract full structured info from a JS/TS module."""
    is_typescript = str(filepath).endswith('.ts')

    imports = extract_ts_imports(source) if is_typescript else extract_js_imports(source)
    exports = extract_exports(source)
    classes = extract_classes(source, filepath)
    functions = extract_functions(source, filepath)
    event_listeners = extract_event_listeners(source)
    state_mutations = extract_state_mutations(source)
    service_calls = extract_service_calls(source)

    docstring = None
    # Check for JSDoc at top of file
    top_doc = re.match(r'/\*\*?\s*\n(.*?)\*/', source, re.DOTALL)
    if top_doc:
        first_line = top_doc.group(1).strip().split('\n')[0]
        docstring = first_line.replace('* ', '').strip()

    return {
        "file": str(filepath),
        "lines": source.count('\n') + 1,
        "language": "typescript" if is_typescript else "javascript",
        "docstring": docstring,
        "imports": imports,
        "exports": exports,
        "classes": classes,
        "functions": functions,
        "event_listeners": event_listeners,
        "state_mutations": state_mutations,
        "service_calls": service_calls,
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: extract_ts_js_model.py <file1.ts> [file2.js ...]")
        print("       extract_ts_js_model.py --dir <directory>")
        sys.exit(1)

    files = []
    if sys.argv[1] == "--dir":
        directory = Path(sys.argv[2])
        files = sorted(directory.rglob("*.ts")) + sorted(directory.rglob("*.js"))
        # Exclude node_modules and compiled outputs where TS source exists
        files = [f for f in files if "node_modules" not in str(f)]
    else:
        files = [Path(f) for f in sys.argv[1:]]

    modules = []
    for filepath in files:
        try:
            source = filepath.read_text()
            mod_info = extract_module_info(filepath, source)
            modules.append(mod_info)
        except Exception as e:
            print(f"Warning: Failed to parse {filepath}: {e}", file=sys.stderr)

    output = {
        "schema": "climate-scheduler-frontend-model-v1",
        "modules": modules,
    }

    print(json.dumps(output, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()