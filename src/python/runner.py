import ast
import builtins
import contextlib
import copy
import io
import json
import math
import re
import sys


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


def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    root_name = name.split(".")[0]
    if root_name not in ALLOWED_IMPORTS:
        raise ImportError(f"Import of '{name}' is not allowed.")
    return builtins.__import__(name, globals, locals, fromlist, level)


SAFE_BUILTINS = {
    "__build_class__": builtins.__build_class__,
    "__import__": safe_import,
    "abs": abs,
    "all": all,
    "any": any,
    "AssertionError": AssertionError,
    "bool": bool,
    "chr": chr,
    "classmethod": classmethod,
    "dict": dict,
    "divmod": divmod,
    "enumerate": enumerate,
    "Exception": Exception,
    "filter": filter,
    "float": float,
    "frozenset": frozenset,
    "getattr": getattr,
    "hasattr": hasattr,
    "hash": hash,
    "int": int,
    "isinstance": isinstance,
    "issubclass": issubclass,
    "iter": iter,
    "len": len,
    "list": list,
    "map": map,
    "max": max,
    "min": min,
    "next": next,
    "object": object,
    "ord": ord,
    "pow": pow,
    "print": builtins.print,
    "property": property,
    "range": range,
    "repr": repr,
    "reversed": reversed,
    "round": round,
    "RuntimeError": RuntimeError,
    "set": set,
    "setattr": setattr,
    "slice": slice,
    "sorted": sorted,
    "staticmethod": staticmethod,
    "str": str,
    "sum": sum,
    "super": super,
    "tuple": tuple,
    "TypeError": TypeError,
    "ValueError": ValueError,
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


def prepare_call_arguments(signature, input_text, globals_dict):
    positional, keyword = parse_input_bindings(input_text)
    parameter_specs = signature.get("parameters", [])

    converted_args = []
    for index, value in enumerate(positional):
        parameter_type = parameter_specs[index]["type"] if index < len(parameter_specs) else None
        converted_args.append(convert_argument(value, parameter_type, globals_dict))

    converted_kwargs = {}
    for parameter in parameter_specs:
        if parameter["name"] in keyword:
            converted_kwargs[parameter["name"]] = convert_argument(
                keyword[parameter["name"]],
                parameter["type"],
                globals_dict,
            )

    for name, value in keyword.items():
        if name not in converted_kwargs:
            converted_kwargs[name] = value

    return converted_args, converted_kwargs


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
        message = "All tests passed. Swing credit awarded."
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
            comparison_value = get_mutated_output(signature, args, kwargs, actual_raw)
            actual = normalize(comparison_value)
            expected = normalize(parse_literal(test_case["expected"]))
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
        return function(*args, **kwargs)

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
