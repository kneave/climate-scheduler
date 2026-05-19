#!/usr/bin/env python3
"""Extract structured codebase model from Python files using AST.

Outputs JSON with: modules, functions (signatures, calls, decorators, async),
classes (bases, methods, class attrs), state mutations (assignment targets),
and cross-references.
"""

import ast
import json
import sys
from pathlib import Path
from collections import defaultdict


def get_source_segment(source, node):
    """Get source text for an AST node."""
    try:
        return ast.get_source_segment(source, node)
    except Exception:
        return None


def extract_decorators(node):
    """Extract decorator names from a function/class node."""
    decorators = []
    for dec in node.decorator_list:
        if isinstance(dec, ast.Name):
            decorators.append(dec.id)
        elif isinstance(dec, ast.Attribute):
            decorators.append(f"{ast.dump(dec)}")
        elif isinstance(dec, ast.Call):
            if isinstance(dec.func, ast.Name):
                decorators.append(dec.func.id)
            elif isinstance(dec.func, ast.Attribute):
                decorators.append(ast.dump(dec.func))
    return decorators


def extract_call_names(node):
    """Extract function/method names from call expressions within a node."""
    calls = set()
    for child in ast.walk(node):
        if isinstance(child, ast.Call):
            if isinstance(child.func, ast.Name):
                calls.add(child.func.id)
            elif isinstance(child.func, ast.Attribute):
                # e.g. self.method, storage.method, coordinator.method
                if isinstance(child.func.value, ast.Name):
                    calls.add(f"{child.func.value.id}.{child.func.attr}")
                elif isinstance(child.func.value, ast.Attribute):
                    # e.g. self.hass.services
                    calls.add(f"{child.func.value.attr}.{child.func.attr}")
                else:
                    calls.add(child.func.attr)
    return sorted(calls)


def extract_assignments(node):
    """Extract assignment target names (state mutations) from a node."""
    assignments = []
    for child in ast.walk(node):
        if isinstance(child, ast.Assign):
            for target in child.targets:
                if isinstance(target, ast.Name):
                    assignments.append(target.id)
                elif isinstance(target, ast.Attribute):
                    if isinstance(target.value, ast.Name):
                        assignments.append(f"{target.value.id}.{target.attr}")
                    elif isinstance(target.value, ast.Attribute):
                        assignments.append(f"{target.value.attr}.{target.attr}")
        elif isinstance(child, ast.AugAssign):
            if isinstance(child.target, ast.Name):
                assignments.append(child.target.id)
            elif isinstance(child.target, ast.Attribute):
                if isinstance(child.target.value, ast.Name):
                    assignments.append(f"{child.target.value.id}.{child.target.attr}")
    return sorted(set(assignments))


def extract_function_info(node, source):
    """Extract structured info from a function or async function def."""
    args = []
    defaults_start = len(node.args.args) - len(node.args.defaults)
    for i, arg in enumerate(node.args.args):
        arg_info = {"name": arg.arg}
        if arg.annotation:
            arg_info["annotation"] = get_source_segment(source, arg.annotation)
        di = i - defaults_start
        if di >= 0 and di < len(node.args.defaults):
            arg_info["default"] = get_source_segment(source, node.args.defaults[di])
        args.append(arg_info)

    # *args
    if node.args.vararg:
        args.append({"name": f"*{node.args.vararg.arg}"})

    # **kwargs
    if node.args.kwarg:
        args.append({"name": f"**{node.args.kwarg.arg}"})

    # keyword-only args
    for i, arg in enumerate(node.args.kwonlyargs):
        arg_info = {"name": arg.arg}
        if arg.annotation:
            arg_info["annotation"] = get_source_segment(source, arg.annotation)
        if i < len(node.args.kw_defaults) and node.args.kw_defaults[i]:
            arg_info["default"] = get_source_segment(source, node.args.kw_defaults[i])
        args.append(arg_info)

    # Return annotation
    returns = None
    if node.returns:
        returns = get_source_segment(source, node.returns)

    # Docstring
    docstring = ast.get_docstring(node)

    return {
        "name": node.name,
        "line": node.lineno,
        "end_line": getattr(node, "end_lineno", None),
        "is_async": isinstance(node, ast.AsyncFunctionDef),
        "args": args,
        "returns": returns,
        "decorators": extract_decorators(node),
        "docstring": docstring.split("\n")[0] if docstring else None,  # first line only
        "calls": extract_call_names(node),
        "assignments": extract_assignments(node),
    }


def extract_class_info(node, source):
    """Extract structured info from a class definition."""
    bases = []
    for base in node.bases:
        bases.append(get_source_segment(source, base) or ast.dump(base))

    methods = []
    class_attrs = []

    for item in node.body:
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
            methods.append(extract_function_info(item, source))
        elif isinstance(item, ast.Assign):
            for target in item.targets:
                if isinstance(target, ast.Name):
                    class_attrs.append(target.id)

    docstring = ast.get_docstring(node)

    return {
        "name": node.name,
        "line": node.lineno,
        "end_line": getattr(node, "end_lineno", None),
        "bases": bases,
        "decorators": extract_decorators(node),
        "docstring": docstring.split("\n")[0] if docstring else None,
        "class_attrs": class_attrs,
        "methods": methods,
    }


def extract_module_info(filepath, source):
    """Extract full structured info from a Python module."""
    tree = ast.parse(source, filename=str(filepath))

    functions = []
    classes = []
    module_calls = set()
    module_assignments = set()

    for node in ast.iter_child_nodes(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            info = extract_function_info(node, source)
            functions.append(info)
            module_calls.update(info["calls"])
            module_assignments.update(info["assignments"])
        elif isinstance(node, ast.ClassDef):
            info = extract_class_info(node, source)
            classes.append(info)
            for method in info["methods"]:
                module_calls.update(method["calls"])
                module_assignments.update(method["assignments"])

    docstring = ast.get_docstring(tree)
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            module_name = node.module or ""
            for alias in node.names:
                imports.append(f"{module_name}.{alias.name}")

    return {
        "file": str(filepath),
        "lines": source.count("\n") + 1,
        "docstring": docstring.split("\n")[0] if docstring else None,
        "imports": sorted(set(imports)),
        "functions": functions,
        "classes": classes,
        "top_level_calls": sorted(module_calls),
        "top_level_assignments": sorted(module_assignments),
    }


def build_call_graph(modules):
    """Build a cross-module call graph from extracted data."""
    # Map function names to their module
    func_to_module = {}
    for mod in modules:
        mod_name = Path(mod["file"]).stem
        for fn in mod["functions"]:
            func_to_module[fn["name"]] = mod_name
        for cls in mod["classes"]:
            for method in cls["methods"]:
                func_to_module[f"{cls['name']}.{method['name']}"] = mod_name

    # Build edges
    edges = []
    for mod in modules:
        mod_name = Path(mod["file"]).stem
        for fn in mod["functions"]:
            for call in fn["calls"]:
                # Simple name match
                base = call.split(".")[0] if "." in call else call
                if base in func_to_module and func_to_module[base] != mod_name:
                    edges.append({
                        "caller": f"{mod_name}.{fn['name']}",
                        "callee": call,
                        "callee_module": func_to_module[base],
                    })
        for cls in mod["classes"]:
            for method in cls["methods"]:
                for call in method["calls"]:
                    base = call.split(".")[0] if "." in call else call
                    if base in func_to_module and func_to_module[base] != mod_name:
                        edges.append({
                            "caller": f"{mod_name}.{cls['name']}.{method['name']}",
                            "callee": call,
                            "callee_module": func_to_module[base],
                        })

    return edges


def main():
    if len(sys.argv) < 2:
        print("Usage: extract_python_model.py <file1.py> [file2.py ...]")
        print("       extract_python_model.py --dir <directory>")
        sys.exit(1)

    files = []
    if sys.argv[1] == "--dir":
        directory = Path(sys.argv[2])
        files = sorted(directory.rglob("*.py"))
        # Exclude test files and __pycache__
        files = [f for f in files if "__pycache__" not in str(f) and ".pytest_cache" not in str(f)]
    else:
        files = [Path(f) for f in sys.argv[1:]]

    modules = []
    for filepath in files:
        source = filepath.read_text()
        mod_info = extract_module_info(filepath, source)
        modules.append(mod_info)

    # Build call graph
    call_graph = build_call_graph(modules)

    output = {
        "schema": "climate-scheduler-python-model-v1",
        "modules": modules,
        "cross_module_calls": call_graph,
    }

    print(json.dumps(output, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()