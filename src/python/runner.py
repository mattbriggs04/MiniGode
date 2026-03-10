import builtins
import json
import sys


SAFE_BUILTINS = {
    "__build_class__": builtins.__build_class__,
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "chr": chr,
    "dict": dict,
    "enumerate": enumerate,
    "filter": filter,
    "float": float,
    "int": int,
    "len": len,
    "list": list,
    "map": map,
    "max": max,
    "min": min,
    "ord": ord,
    "print": lambda *args, **kwargs: None,
    "range": range,
    "reversed": reversed,
    "set": set,
    "sorted": sorted,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "zip": zip,
}


def normalize(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple)):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        return {str(key): normalize(item) for key, item in value.items()}
    if isinstance(value, set):
        return sorted(normalize(item) for item in value)
    return repr(value)


def display_input(args):
    return normalize(args[0]) if len(args) == 1 else normalize(args)


def main():
    payload = json.loads(sys.stdin.read())
    globals_dict = {"__builtins__": SAFE_BUILTINS, "__name__": "__submission__"}
    locals_dict = globals_dict

    try:
        exec(compile(payload["submission"], "<submission>", "exec"), globals_dict, locals_dict)
    except Exception as error:
        print(
            json.dumps(
                {
                    "passed": False,
                    "message": f"Compile error: {error}",
                    "testsPassed": 0,
                    "totalTests": len(payload["tests"]),
                    "results": [],
                }
            )
        )
        return

    solution_class = locals_dict.get("Solution")
    if not isinstance(solution_class, type):
        print(
            json.dumps(
                {
                    "passed": False,
                    "message": "Compile error: Expected a class named Solution.",
                    "testsPassed": 0,
                    "totalTests": len(payload["tests"]),
                    "results": [],
                }
            )
        )
        return

    try:
        solution = solution_class()
    except Exception as error:
        print(
            json.dumps(
                {
                    "passed": False,
                    "message": f"Compile error: Could not instantiate Solution: {error}",
                    "testsPassed": 0,
                    "totalTests": len(payload["tests"]),
                    "results": [],
                }
            )
        )
        return

    function_name = payload["functionName"]
    function = getattr(solution, function_name, None)
    if not callable(function):
        print(
            json.dumps(
                {
                    "passed": False,
                    "message": f"Compile error: Expected Solution.{function_name}.",
                    "testsPassed": 0,
                    "totalTests": len(payload["tests"]),
                    "results": [],
                }
            )
        )
        return

    results = []
    for test_case in payload["tests"]:
        expected = normalize(test_case["expected"])
        visibility = test_case.get("visibility", "hidden")
        shown = visibility == "shown"
        try:
            actual = normalize(function(*test_case["args"]))
            passed = actual == expected
            results.append(
                {
                    "index": test_case["index"],
                    "label": test_case["label"],
                    "visibility": visibility,
                    "description": test_case["description"],
                    "passed": passed,
                    "input": display_input(test_case["args"]) if shown else None,
                    "expected": expected if shown else None,
                    "actual": actual if shown else None,
                }
            )
        except Exception as error:
            results.append(
                {
                    "index": test_case["index"],
                    "label": test_case["label"],
                    "visibility": visibility,
                    "description": test_case["description"],
                    "passed": False,
                    "input": display_input(test_case["args"]) if shown else None,
                    "expected": expected if shown else None,
                    "actual": None,
                    "error": str(error),
                }
            )

    tests_passed = len([result for result in results if result["passed"]])
    first_failure = next((result for result in results if not result["passed"]), None)

    if tests_passed == len(results):
        message = "All tests passed. Swing credit awarded."
    elif first_failure and "error" in first_failure:
        message = f"Runtime error: {first_failure['error']}"
    else:
        label = first_failure["label"] if first_failure else "unknown test"
        message = f"Failed on: {label}"

    print(
        json.dumps(
            {
                "passed": tests_passed == len(results),
                "message": message,
                "testsPassed": tests_passed,
                "totalTests": len(results),
                "results": results,
            }
        )
    )


if __name__ == "__main__":
    main()
