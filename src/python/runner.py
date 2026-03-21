import ast
import builtins
import contextlib
import copy
import io
import json
import math
import re
import sys

try:
    import resource
except ImportError:  # pragma: no cover - not available on every platform
    resource = None


ALLOWED_IMPORTS = {
    "bisect",
    "collections",
    "datetime",
    "functools",
    "heapq",
    "itertools",
    "math",
    "operator",
    "random",
    "string",
    "typing",
}

ALLOWED_MAGIC_METHODS = {"__init__"}
FORBIDDEN_IDENTIFIERS = {
    "__annotations__",
    "__builtins__",
    "__cached__",
    "__debug__",
    "__doc__",
    "__file__",
    "__import__",
    "__loader__",
    "__package__",
    "__spec__",
    "breakpoint",
    "compile",
    "delattr",
    "dir",
    "eval",
    "exec",
    "exit",
    "getattr",
    "globals",
    "hasattr",
    "help",
    "input",
    "locals",
    "memoryview",
    "object",
    "open",
    "quit",
    "setattr",
    "super",
    "type",
    "vars",
}
FORBIDDEN_ATTRIBUTE_NAMES = {
    "co_consts",
    "co_names",
    "co_varnames",
    "cr_frame",
    "f_back",
    "f_globals",
    "f_locals",
    "gi_frame",
    "mro",
    "tb_frame",
}
BLOCKED_NODE_TYPES = tuple(
    node_type
    for node_type in (
        ast.AsyncFor,
        ast.AsyncFunctionDef,
        ast.AsyncWith,
        ast.Await,
        ast.Global,
        ast.Nonlocal,
        getattr(ast, "TryStar", None),
        ast.Yield,
        ast.YieldFrom,
    )
    if node_type is not None
)


class SourceValidationError(Exception):
    pass


class SecurityValidator(ast.NodeVisitor):
    def __init__(self, *, allow_imports=False, allow_dunder_defs=False, allowed_names=None):
        self.allow_imports = allow_imports
        self.allow_dunder_defs = allow_dunder_defs
        self.allowed_names = set(allowed_names or ())

    def visit(self, node):
        if isinstance(node, BLOCKED_NODE_TYPES):
            raise SourceValidationError(f"{node.__class__.__name__} is not allowed.")
        return super().visit(node)

    def visit_Import(self, node):
        if not self.allow_imports:
            raise SourceValidationError("Import statements are not allowed here.")

        for alias in node.names:
            root_name = alias.name.split(".")[0]
            if root_name not in ALLOWED_IMPORTS:
                raise SourceValidationError(f"Import of '{alias.name}' is not allowed.")
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        if not self.allow_imports:
            raise SourceValidationError("Import statements are not allowed here.")

        module_name = (node.module or "").split(".")[0]
        if node.level != 0 or module_name not in ALLOWED_IMPORTS:
            raise SourceValidationError(f"Import of '{node.module}' is not allowed.")
        self.generic_visit(node)

    def visit_Name(self, node):
        if node.id in self.allowed_names:
            return
        if node.id in FORBIDDEN_IDENTIFIERS or node.id.startswith("__"):
            raise SourceValidationError(f"Identifier '{node.id}' is not allowed.")

    def visit_Attribute(self, node):
        if node.attr in FORBIDDEN_ATTRIBUTE_NAMES or node.attr.startswith("__"):
            raise SourceValidationError(f"Attribute '{node.attr}' is not allowed.")
        self.generic_visit(node)

    def visit_Call(self, node):
        if isinstance(node.func, ast.Name) and node.func.id in FORBIDDEN_IDENTIFIERS:
            raise SourceValidationError(f"Call to '{node.func.id}' is not allowed.")
        self.generic_visit(node)

    def visit_ClassDef(self, node):
        if node.name.startswith("__"):
            raise SourceValidationError(f"Class name '{node.name}' is not allowed.")
        if node.decorator_list:
            raise SourceValidationError("Decorators are not allowed.")
        self.generic_visit(node)

    def visit_FunctionDef(self, node):
        if node.decorator_list:
            raise SourceValidationError("Decorators are not allowed.")
        if node.name.startswith("__") and (not self.allow_dunder_defs or node.name not in ALLOWED_MAGIC_METHODS):
            raise SourceValidationError(f"Function name '{node.name}' is not allowed.")
        self.generic_visit(node)


def validate_top_level_statements(tree, allowed_statement_types):
    for statement in tree.body:
        if isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Constant) and isinstance(statement.value.value, str):
            continue
        if not isinstance(statement, allowed_statement_types):
            raise SourceValidationError(f"Top-level {statement.__class__.__name__} is not allowed.")


def validate_submission_source(source):
    tree = ast.parse(source, filename="<submission>")
    validate_top_level_statements(
        tree,
        (ast.Import, ast.ImportFrom, ast.ClassDef, ast.FunctionDef, ast.Assign, ast.AnnAssign, ast.Expr),
    )
    SecurityValidator(allow_imports=True, allow_dunder_defs=True).visit(tree)


def validate_runtime_prelude(source):
    tree = ast.parse(source, filename="<prelude>")
    validate_top_level_statements(
        tree,
        (ast.Import, ast.ImportFrom, ast.ClassDef, ast.FunctionDef, ast.Assign, ast.AnnAssign, ast.Expr),
    )
    SecurityValidator(allow_imports=True, allow_dunder_defs=True).visit(tree)


def validate_hidden_harness(source):
    tree = ast.parse(source, filename="<tests>")
    if len(tree.body) != 1 or not isinstance(tree.body[0], ast.FunctionDef) or tree.body[0].name != "check":
        raise SourceValidationError("Hidden harness must define only check(candidate).")

    check_function = tree.body[0]
    if len(check_function.args.args) != 1 or check_function.args.args[0].arg != "candidate":
        raise SourceValidationError("Hidden harness must define check(candidate).")

    for statement in check_function.body:
        if isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Constant) and isinstance(statement.value.value, str):
            continue
        if not isinstance(statement, ast.Assert):
            raise SourceValidationError("Hidden harness may only contain assert statements.")

    SecurityValidator(allowed_names={"candidate"}).visit(tree)


def apply_resource_limits():
    if resource is None:
        return

    try:
        resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
    except (AttributeError, OSError, ValueError):
        pass

    memory_limit_bytes = 512 * 1024 * 1024
    for limit_name in ("RLIMIT_AS", "RLIMIT_DATA"):
        try:
            limit_key = getattr(resource, limit_name)
            resource.setrlimit(limit_key, (memory_limit_bytes, memory_limit_bytes))
        except (AttributeError, OSError, ValueError):
            continue


SAFE_BUILTINS = {
    "__build_class__": builtins.__build_class__,
    "__import__": builtins.__import__,
    "abs": abs,
    "all": all,
    "any": any,
    "AssertionError": AssertionError,
    "bool": bool,
    "chr": chr,
    "dict": dict,
    "divmod": divmod,
    "enumerate": enumerate,
    "Exception": Exception,
    "filter": filter,
    "float": float,
    "frozenset": frozenset,
    "hash": hash,
    "IndexError": IndexError,
    "int": int,
    "isinstance": isinstance,
    "issubclass": issubclass,
    "iter": iter,
    "KeyError": KeyError,
    "len": len,
    "list": list,
    "map": map,
    "max": max,
    "min": min,
    "next": next,
    "ord": ord,
    "pow": pow,
    "print": builtins.print,
    "range": range,
    "repr": repr,
    "reversed": reversed,
    "round": round,
    "RuntimeError": RuntimeError,
    "set": set,
    "slice": slice,
    "sorted": sorted,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "TypeError": TypeError,
    "ValueError": ValueError,
    "ZeroDivisionError": ZeroDivisionError,
    "zip": zip,
}


def linked_list_to_list(node, limit=5000):
    values = []
    current = node
    steps = 0
    while current is not None and hasattr(current, "val"):
        values.append(normalize(current.val))
        current = getattr(current, "next", None)
        steps += 1
        if steps >= limit:
            values.append("...")
            break
    return values


def tree_to_list(root):
    if root is None:
        return []

    values = []
    queue = [root]
    while queue:
        node = queue.pop(0)
        if node is None:
            values.append(None)
            continue

        values.append(normalize(getattr(node, "val", None)))
        left = getattr(node, "left", None)
        right = getattr(node, "right", None)
        if left is not None or right is not None or queue:
            queue.append(left)
            queue.append(right)

    while values and values[-1] is None:
        values.pop()

    return values


def normalize(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple)):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        return {str(key): normalize(item) for key, item in value.items()}
    if isinstance(value, set):
        return sorted(normalize(item) for item in value)

    class_name = value.__class__.__name__
    if class_name == "ListNode":
        return linked_list_to_list(value)
    if class_name == "TreeNode":
        return tree_to_list(value)

    return repr(value)


def normalize_python_literals(text):
    normalized = str(text or "").strip()
    normalized = re.sub(r"\bnull\b", "None", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\btrue\b", "True", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bfalse\b", "False", normalized, flags=re.IGNORECASE)
    return normalized


def parse_literal(text):
    source = normalize_python_literals(text)
    try:
        return ast.literal_eval(source)
    except Exception:
        return source


def parse_input_bindings(text):
    source = f"_f({normalize_python_literals(text)})"
    expression = ast.parse(source, mode="eval").body
    if not isinstance(expression, ast.Call):
        raise ValueError("Example input must parse into a function call.")

    positional = [ast.literal_eval(argument) for argument in expression.args]
    keyword = {argument.arg: ast.literal_eval(argument.value) for argument in expression.keywords}
    return positional, keyword


def annotation_contains(type_name, fragment):
    return fragment in str(type_name or "")


def convert_argument(value, type_name, globals_dict):
    if isinstance(value, list) and annotation_contains(type_name, "ListNode"):
        converter = globals_dict.get("list_node")
        if callable(converter):
            return converter(value)
    if isinstance(value, list) and annotation_contains(type_name, "TreeNode"):
        converter = globals_dict.get("tree_node")
        if callable(converter):
            return converter(value)
    return value


def is_tree_node_instance(value):
    return value is not None and value.__class__.__name__ == "TreeNode"


def find_tree_node_by_value(root, target_value):
    if not is_tree_node_instance(root):
        return None

    queue = [root]
    while queue:
        node = queue.pop(0)
        if getattr(node, "val", None) == target_value:
            return node

        left = getattr(node, "left", None)
        right = getattr(node, "right", None)
        if is_tree_node_instance(left):
            queue.append(left)
        if is_tree_node_instance(right):
            queue.append(right)

    return None


def resolve_tree_reference(value, tree_roots):
    if value is None or is_tree_node_instance(value) or isinstance(value, list):
        return value

    for root in tree_roots:
        resolved = find_tree_node_by_value(root, value)
        if resolved is not None:
            return resolved

    return value


def expand_tree_aliases(signature, positional, keyword):
    if "tree" not in keyword:
        return positional, keyword

    parameter_specs = signature.get("parameters", [])
    tree_parameter_names = [
        parameter["name"] for parameter in parameter_specs if annotation_contains(parameter.get("type"), "TreeNode")
    ]

    if not tree_parameter_names:
        return positional, keyword

    tree_value = keyword.pop("tree")
    if "original" in tree_parameter_names and "cloned" in tree_parameter_names:
        if "original" not in keyword and "cloned" not in keyword:
            keyword["original"] = copy.deepcopy(tree_value)
            keyword["cloned"] = copy.deepcopy(tree_value)
            return positional, keyword

    if "root" in tree_parameter_names and "root" not in keyword:
        keyword["root"] = tree_value
        return positional, keyword

    if len(tree_parameter_names) == 1 and tree_parameter_names[0] not in keyword:
        keyword[tree_parameter_names[0]] = tree_value
        return positional, keyword

    keyword["tree"] = tree_value
    return positional, keyword


def prepare_runtime_arguments(signature, positional, keyword, globals_dict):
    parameter_specs = signature.get("parameters", [])
    positional_values, keyword_values = expand_tree_aliases(signature, list(positional), dict(keyword))
    tree_roots = []

    converted_args = []
    converted_kwargs = {}
    for index, parameter in enumerate(parameter_specs):
        parameter_name = parameter["name"]
        parameter_type = parameter["type"]

        has_positional = index < len(positional_values)
        has_keyword = parameter_name in keyword_values
        if not has_positional and not has_keyword:
            continue

        raw_value = positional_values[index] if has_positional else keyword_values.pop(parameter_name)
        converted_value = convert_argument(raw_value, parameter_type, globals_dict)
        if annotation_contains(parameter_type, "TreeNode"):
            converted_value = resolve_tree_reference(converted_value, tree_roots)
            if is_tree_node_instance(converted_value):
                tree_roots.append(converted_value)

        if has_positional:
            converted_args.append(converted_value)
        else:
            converted_kwargs[parameter_name] = converted_value

    for name, value in keyword_values.items():
        converted_kwargs[name] = value

    return converted_args, converted_kwargs


def prepare_call_arguments(signature, input_text, globals_dict):
    positional, keyword = parse_input_bindings(input_text)
    return prepare_runtime_arguments(signature, positional, keyword, globals_dict)


def get_mutated_output(signature, args, kwargs, actual):
    if actual is not None:
        return actual

    parameter_specs = signature.get("parameters", [])
    if not parameter_specs:
        return actual

    first_parameter = parameter_specs[0]["name"]
    if first_parameter in kwargs:
        return kwargs[first_parameter]
    if args:
        return args[0]

    return actual


def normalize_sample_output(actual, expected):
    if actual is not None and actual.__class__.__name__ in {"TreeNode", "ListNode"} and isinstance(
        expected, (bool, int, float, str)
    ):
        return normalize(getattr(actual, "val", None))

    return normalize(actual)


def values_match(actual, expected):
    if isinstance(actual, (int, float)) and isinstance(expected, (int, float)):
        return math.isclose(actual, expected, rel_tol=1e-6, abs_tol=1e-6)
    return actual == expected


def capture_stdout(callback):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        result = callback()
    return result, output.getvalue().rstrip()


def display_input(args):
    return normalize(args[0]) if len(args) == 1 else normalize(args)


def build_failure(message, total_tests, results=None, scope="all"):
    return {
        "passed": False,
        "scope": scope,
        "message": message,
        "testsPassed": len([result for result in (results or []) if result.get("passed")]),
        "totalTests": total_tests,
        "results": results or [],
    }


def build_summary(results, scope="all"):
    tests_passed = len([result for result in results if result.get("passed")])
    first_failure = next((result for result in results if not result.get("passed")), None)

    if scope == "sample" and tests_passed == len(results):
        message = "Sample tests passed. Hidden tests not run."
    elif tests_passed == len(results):
        message = "All tests passed."
    elif first_failure and "error" in first_failure:
        message = f"Runtime error: {first_failure['error']}"
    else:
        label = first_failure["label"] if first_failure else "unknown test"
        message = f"Failed on: {label}"

    return {
        "passed": tests_passed == len(results),
        "scope": scope,
        "message": message,
        "testsPassed": tests_passed,
        "totalTests": len(results),
        "results": results,
    }


def run_structured_tests(tests, function):
    results = []
    for test_case in tests:
        expected = normalize(test_case["expected"])
        visibility = test_case.get("visibility", "hidden")
        shown = visibility == "shown"
        output = io.StringIO()
        try:
            with contextlib.redirect_stdout(output):
                actual_raw = function(*test_case["args"])
            actual = normalize(actual_raw)
            passed = actual == expected
            reveal = shown or not passed
            stdout = output.getvalue().rstrip()
            results.append(
                {
                    "index": test_case["index"],
                    "label": test_case["label"],
                    "visibility": visibility,
                    "description": test_case["description"],
                    "passed": passed,
                    "input": display_input(test_case["args"]) if reveal else None,
                    "expected": expected if reveal else None,
                    "actual": actual if reveal else None,
                    "stdout": stdout if reveal and stdout else None,
                }
            )
        except Exception as error:
            stdout = output.getvalue().rstrip()
            reveal = True
            results.append(
                {
                    "index": test_case["index"],
                    "label": test_case["label"],
                    "visibility": visibility,
                    "description": test_case["description"],
                    "passed": False,
                    "input": display_input(test_case["args"]) if reveal else None,
                    "expected": expected if reveal else None,
                    "actual": None,
                    "stdout": stdout if reveal and stdout else None,
                    "error": str(error),
                }
            )
    return results


def run_sample_tests(sample_tests, candidate, signature, globals_dict):
    results = []

    for test_case in sample_tests:
        output = io.StringIO()
        try:
            args, kwargs = prepare_call_arguments(signature, test_case["input"], globals_dict)
            with contextlib.redirect_stdout(output):
                actual_raw = candidate(*args, **kwargs)
            expected = normalize(parse_literal(test_case["expected"]))
            comparison_value = get_mutated_output(signature, args, kwargs, actual_raw)
            actual = normalize_sample_output(comparison_value, expected)
            stdout = output.getvalue().rstrip()
            results.append(
                {
                    "index": test_case["index"],
                    "label": test_case["label"],
                    "visibility": "shown",
                    "description": test_case["description"],
                    "passed": values_match(actual, expected),
                    "input": test_case["input"],
                    "expected": test_case["expected"],
                    "actual": actual,
                    "stdout": stdout or None,
                }
            )
        except Exception as error:
            results.append(
                {
                    "index": test_case["index"],
                    "label": test_case["label"],
                    "visibility": "shown",
                    "description": test_case["description"],
                    "passed": False,
                    "input": test_case["input"],
                    "expected": test_case["expected"],
                    "actual": None,
                    "stdout": output.getvalue().rstrip() or None,
                    "error": str(error),
                }
            )

    return results


def find_candidate_call(node):
    for child in ast.walk(node):
        if isinstance(child, ast.Call) and isinstance(child.func, ast.Name) and child.func.id == "candidate":
            return child
    return None


def candidate_call_to_input_text(call_node):
    if call_node is None:
        return None

    parts = [ast.unparse(argument) for argument in call_node.args]
    parts.extend(
        f"{keyword.arg} = {ast.unparse(keyword.value)}"
        for keyword in call_node.keywords
        if keyword.arg is not None
    )
    return ", ".join(parts)


def expected_text_from_assert(test_node, candidate_call):
    if (
        candidate_call is not None
        and isinstance(test_node, ast.Compare)
        and len(test_node.ops) == 1
        and len(test_node.comparators) == 1
    ):
        if test_node.left is candidate_call:
            return ast.unparse(test_node.comparators[0])
        if test_node.comparators[0] is candidate_call:
            return ast.unparse(test_node.left)

    return ast.unparse(test_node)


class AssertRecorder(ast.NodeTransformer):
    def visit_Assert(self, node):
        self.generic_visit(node)
        candidate_call = find_candidate_call(node.test)
        metadata = ast.Dict(
            keys=[
                ast.Constant(value="input"),
                ast.Constant(value="expected"),
                ast.Constant(value="assertion"),
            ],
            values=[
                ast.Constant(value=candidate_call_to_input_text(candidate_call)),
                ast.Constant(value=expected_text_from_assert(node.test, candidate_call)),
                ast.Constant(value=ast.unparse(node.test)),
            ],
        )
        predicate = ast.Lambda(
            args=ast.arguments(
                posonlyargs=[],
                args=[],
                kwonlyargs=[],
                kw_defaults=[],
                defaults=[],
            ),
            body=copy.deepcopy(node.test),
        )
        actual_getter = ast.Constant(value=None)
        if candidate_call is not None:
            actual_getter = ast.Lambda(
                args=ast.arguments(
                    posonlyargs=[],
                    args=[],
                    kwonlyargs=[],
                    kw_defaults=[],
                    defaults=[],
                ),
                body=copy.deepcopy(candidate_call),
            )
        return ast.copy_location(
            ast.Expr(
                value=ast.Call(
                    func=ast.Name(id="_record_assert", ctx=ast.Load()),
                    args=[metadata, predicate, actual_getter],
                    keywords=[],
                )
            ),
            node,
        )


def run_hidden_harness(hidden_test_harness, hidden_start_index, globals_dict, candidate):
    results = []

    def record_assert(metadata, predicate, actual_getter=None):
        label = f"Hidden {len(results) + 1}"
        index = hidden_start_index + len(results)
        output = io.StringIO()
        try:
            with contextlib.redirect_stdout(output):
                passed = bool(predicate())
            stdout = output.getvalue().rstrip()
            reveal = not passed
            actual = None
            actual_error = None
            if reveal and callable(actual_getter):
                try:
                    actual, extra_stdout = capture_stdout(actual_getter)
                    if not stdout and extra_stdout:
                        stdout = extra_stdout
                    actual = normalize(actual)
                except Exception as error:
                    actual_error = str(error)
            results.append(
                {
                    "index": index,
                    "label": label,
                    "visibility": "hidden",
                    "description": label,
                    "passed": passed,
                    "input": metadata.get("input") if reveal else None,
                    "expected": metadata.get("expected") if reveal else None,
                    "actual": actual if reveal else None,
                    "stdout": stdout if reveal and stdout else None,
                    **({"error": actual_error} if actual_error else {}),
                }
            )
        except Exception as error:
            stdout = output.getvalue().rstrip()
            results.append(
                {
                    "index": index,
                    "label": label,
                    "visibility": "hidden",
                    "description": label,
                    "passed": False,
                    "input": metadata.get("input"),
                    "expected": metadata.get("expected") or metadata.get("assertion"),
                    "actual": None,
                    "stdout": stdout or None,
                    "error": str(error),
                }
            )

    globals_dict["_record_assert"] = record_assert

    module = ast.parse(hidden_test_harness, filename="<tests>")
    transformed = AssertRecorder().visit(module)
    ast.fix_missing_locations(transformed)

    exec(compile(transformed, "<tests>", "exec"), globals_dict, globals_dict)

    check = globals_dict.get("check")
    if not callable(check):
        raise RuntimeError("Expected test harness to define check(candidate).")

    try:
        check(candidate)
    except Exception as error:
        label = f"Hidden {len(results) + 1}"
        results.append(
            {
                "index": hidden_start_index + len(results),
                "label": label,
                "visibility": "hidden",
                "description": label,
                "passed": False,
                "error": str(error),
            }
        )

    return results


def get_total_tests(payload):
    if payload.get("mode") == "structured":
        return len(payload.get("tests", []))
    return len(payload.get("sampleTests", [])) + int(payload.get("hiddenTestCount", 0))


def main():
    payload = json.loads(sys.stdin.read())
    total_tests = get_total_tests(payload)
    scope = payload.get("scope", "all")
    globals_dict = {"__builtins__": SAFE_BUILTINS, "__name__": "__submission__"}
    locals_dict = globals_dict

    try:
        apply_resource_limits()
        if payload.get("runtimePrelude"):
            validate_runtime_prelude(payload["runtimePrelude"])
        validate_submission_source(payload.get("submission", ""))
        if scope == "all" and payload.get("hiddenTestHarness"):
            validate_hidden_harness(payload["hiddenTestHarness"])
        if payload.get("runtimePrelude"):
            exec(compile(payload["runtimePrelude"], "<prelude>", "exec"), globals_dict, locals_dict)
        exec(compile(payload["submission"], "<submission>", "exec"), globals_dict, locals_dict)
    except Exception as error:
        print(json.dumps(build_failure(f"Compile error: {error}", total_tests, scope=scope)))
        return

    solution_class = locals_dict.get("Solution")
    if not isinstance(solution_class, type):
        print(json.dumps(build_failure("Compile error: Expected a class named Solution.", total_tests, scope=scope)))
        return

    try:
        solution = solution_class()
    except Exception as error:
        print(json.dumps(build_failure(f"Compile error: Could not instantiate Solution: {error}", total_tests, scope=scope)))
        return

    function_name = payload["functionName"]
    function = getattr(solution, function_name, None)
    if not callable(function):
        print(json.dumps(build_failure(f"Compile error: Expected Solution.{function_name}.", total_tests, scope=scope)))
        return

    if payload.get("mode") == "structured":
        results = run_structured_tests(payload.get("tests", []), function)
        print(json.dumps(build_summary(results, scope)))
        return

    def candidate(*args, **kwargs):
        call_args, call_kwargs = prepare_runtime_arguments(payload.get("signature", {}), args, kwargs, globals_dict)
        return function(*call_args, **call_kwargs)

    sample_results = []
    try:
        sample_results = run_sample_tests(
            payload.get("sampleTests", []),
            candidate,
            payload.get("signature", {}),
            globals_dict,
        )
        hidden_results = []
        if scope == "all" and payload.get("hiddenTestHarness"):
            hidden_results = run_hidden_harness(
                payload.get("hiddenTestHarness", ""),
                len(sample_results),
                globals_dict,
                candidate,
            )
    except Exception as error:
        print(json.dumps(build_failure(f"Python runner failed: {error}", total_tests, sample_results, scope)))
        return

    print(json.dumps(build_summary([*sample_results, *hidden_results], scope)))


if __name__ == "__main__":
    main()
