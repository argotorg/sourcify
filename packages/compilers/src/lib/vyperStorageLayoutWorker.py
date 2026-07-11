import contextlib
import copy
import hashlib
import json
import re
import sys
from pathlib import PurePosixPath


def _version():
    import vyper

    return getattr(vyper, "__version__", "unknown")


def _version_tuple(value):
    out = []
    for part in value.lstrip("v").split("."):
        digits = ""
        for char in part:
            if char.isdigit():
                digits += char
            else:
                break
        out.append(int(digits or 0))
    return tuple([*out, 0, 0, 0][:3])


def _words(typ):
    for name in ("storage_size_in_words", "size_in_words"):
        value = getattr(typ, name, None)
        if isinstance(value, int):
            return max(1, value)
    value = getattr(typ, "size_in_bytes", None)
    if isinstance(value, int):
        return max(1, (value + 31) // 32)
    getter = getattr(typ, "get_size_in", None)
    if callable(getter):
        try:
            from vyper.semantics.types import DataLocation

            return max(1, int(getter(DataLocation.STORAGE)))
        except Exception:
            pass
    return 1


def _render_type(typ, definitions, seen=None):
    if seen is None:
        seen = set()
    marker = id(typ)
    if marker in seen:
        return str(getattr(typ, "name", typ.__class__.__name__))
    seen = set(seen)
    seen.add(marker)

    key = getattr(typ, "keytype", None)
    value = getattr(typ, "valuetype", None)
    if key is None:
        key = getattr(typ, "key_type", None)
    if value is None:
        value = getattr(typ, "value_type", None)
    cls_name = typ.__class__.__name__.lower()
    if key is not None and value is not None and ("map" in cls_name or "mapping" in cls_name):
        return "HashMap[{}, {}]".format(
            _render_type(key, definitions, seen),
            _render_type(value, definitions, seen),
        )

    members = None
    if "struct" in cls_name:
        members = getattr(typ, "member_types", None)
        if members is None:
            members = getattr(typ, "members", None)
        if members is None and hasattr(typ, "tuple_items"):
            try:
                members = dict(typ.tuple_items())
            except Exception:
                members = None
    if isinstance(members, dict) and members:
        label = getattr(typ, "name", None) or getattr(typ, "_id", None) or str(typ)
        label = str(label)
        offset = 0
        serialized = []
        for name, member_type in members.items():
            rendered = _render_type(member_type, definitions, seen)
            size = _words(member_type)
            serialized.append(
                {
                    "name": str(name),
                    "type": rendered,
                    "slot": offset,
                    "n_slots": size,
                }
            )
            offset += size
        definition = {"members": serialized, "n_slots": offset}
        existing = definitions.get(label)
        if existing is not None and existing != definition:
            digest = hashlib.sha256(
                json.dumps(
                    definition, sort_keys=True, separators=(",", ":")
                ).encode("utf8")
            ).hexdigest()
            label = "{}{}{}".format(label, "$", digest)
        definitions[label] = definition
        return label

    subtype = getattr(typ, "subtype", None)
    if subtype is None and "array" in cls_name:
        subtype = getattr(typ, "value_type", None)
    count = getattr(typ, "count", None)
    if count is None:
        count = getattr(typ, "max_count", None)
    if count is None:
        count = getattr(typ, "length", None)
    if subtype is not None and isinstance(count, int):
        inner = _render_type(subtype, definitions, seen)
        if cls_name.startswith(("darray", "dynamic")):
            return "DynArray[{}, {}]".format(inner, count)
        return "{}[{}]".format(inner, count)

    # Modern Vyper types render correctly. Historical mapping objects are
    # handled above to avoid their key/value-reversed __repr__ implementation.
    return str(typ)


def _candidate_interface_keys(path):
    normalized = path.replace("\\", "/")
    pure = PurePosixPath(normalized)
    keys = {normalized, pure.name, pure.stem}
    if pure.suffix:
        keys.add(str(pure.with_suffix("")))
    return keys


def _interface_codes(request):
    target = request["target"]
    available = {}

    for path, item in request.get("sources", {}).items():
        if path == target or not isinstance(item, dict):
            continue
        content = item.get("content")
        if not isinstance(content, str):
            continue
        value = {"type": "vyper", "code": content}
        for key in _candidate_interface_keys(path):
            available[key] = value

    for path, item in request.get("interfaces", {}).items():
        if not isinstance(item, dict):
            continue
        if isinstance(item.get("abi"), list):
            value = {"type": "json", "code": item["abi"]}
        elif isinstance(item.get("content"), str):
            content = item["content"]
            if path.endswith(".json"):
                try:
                    value = {"type": "json", "code": json.loads(content)}
                except Exception:
                    value = {"type": "vyper", "code": content}
            else:
                value = {"type": "vyper", "code": content}
        else:
            continue
        for key in _candidate_interface_keys(path):
            available[key] = value

    # Most historical compiler APIs expect interfaces to be keyed by the local
    # alias. Add aliases from the old import syntaxes while retaining the path
    # and stem keys used by later releases.
    source = request["source"]
    for module, alias in re.findall(
        r"(?m)^\s*import\s+([A-Za-z0-9_./]+)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)",
        source,
    ):
        candidates = _candidate_interface_keys(module)
        candidates.update(_candidate_interface_keys(module + ".vy"))
        candidates.update(_candidate_interface_keys(module + ".json"))
        value = next((available[key] for key in candidates if key in available), None)
        if value is not None:
            available[alias] = value

    for module, name, alias in re.findall(
        r"(?m)^\s*from\s+([A-Za-z0-9_./]+)\s+import\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?",
        source,
    ):
        path = module.replace(".", "/") + "/" + name
        candidates = _candidate_interface_keys(path)
        candidates.update(_candidate_interface_keys(path + ".vy"))
        candidates.update(_candidate_interface_keys(path + ".json"))
        value = next((available[key] for key in candidates if key in available), None)
        if value is not None:
            available[alias or name] = value

    return available


def _compiler_data(request):
    from vyper.compiler.phases import CompilerData

    source = request["source"]
    target = request["target"]
    interfaces = _interface_codes(request)
    attempts = (
        lambda: CompilerData(source, target, interfaces, 0),
        lambda: CompilerData(source, target, interfaces),
        lambda: CompilerData(source, target),
        lambda: CompilerData(source),
    )
    last = None
    for attempt in attempts:
        try:
            return attempt()
        except TypeError as exc:
            last = exc
    raise last


def _native_layout(request):
    # Vyper 0.2.16-0.4.0 computes the layout for Standard JSON, but its
    # formatter accidentally drops the field. Read the compiler data before
    # that lossy formatting step so imports and settings remain identical to
    # the verified compilation.
    from vyper.cli import vyper_json

    input_dict = copy.deepcopy(request["json_input"])
    settings = input_dict.setdefault("settings", {})
    output_selection = copy.deepcopy(settings.get("outputSelection", {}))
    output_selection[request["target"]] = ["layout"]

    # Ask only for the AST on otherwise unselected dependency sources. Before
    # 0.4.0 this avoids an empty-selection formatter bug; in module-capable
    # releases it also retains each imported module's CompilerData for scoped
    # type enrichment. The target still produces only layout.
    for source_path in input_dict.get("sources", {}):
        if source_path != request["target"] and not output_selection.get(source_path):
            output_selection[source_path] = ["ast"]
    settings["outputSelection"] = output_selection

    # Capture the exact CompilerData object created by this Standard-JSON
    # compile. This preserves the compiler's version-specific FileInput,
    # InputBundle, Settings, import, and storage-layout-override handling. It
    # also avoids reconstructing the incompatible 0.4.x constructor API.
    import vyper.compiler as compiler_module

    captured = []
    original_compiler_data = compiler_module.CompilerData

    def recording_compiler_data(*args, **kwargs):
        data = original_compiler_data(*args, **kwargs)
        captured.append(data)
        return data

    compiler_module.CompilerData = recording_compiler_data
    try:
        result = vyper_json.compile_from_input_dict(input_dict)
    finally:
        compiler_module.CompilerData = original_compiler_data
    compiler_data = result[0] if isinstance(result, tuple) else result
    data = compiler_data.get(request["target"])
    if data is None:
        matches = [
            value
            for key, value in compiler_data.items()
            if str(key) == request["target"]
        ]
        if len(matches) != 1:
            raise RuntimeError("compiler returned no unique target layout")
        data = matches[0]
    layout = data.get("layout")
    if not isinstance(layout, dict):
        raise RuntimeError("compiler returned no native layout")
    target_data = None
    for candidate in captured:
        candidate_path = getattr(candidate, "contract_name", None)
        file_input = getattr(candidate, "file_input", None)
        if file_input is not None:
            candidate_path = getattr(file_input, "path", candidate_path)
        if str(candidate_path) == request["target"]:
            target_data = candidate
            break
    if target_data is None and len(captured) == 1:
        target_data = captured[0]
    return layout, target_data, captured


def _legacy_global_context(request):
    definitions = {}
    data = None
    try:
        data = _compiler_data(request)
        context = data.global_ctx
    except (ImportError, ModuleNotFoundError):
        try:
            from vyper.ast import parse_to_ast
        except ImportError:
            from vyper.ast_utils import parse_to_ast
        from vyper.parser.global_context import GlobalContext

        context = GlobalContext.get_global_context(
            parse_to_ast(request["source"]),
            interface_codes=_interface_codes(request),
        )

    layout = {}
    for name, record in context._globals.items():
        typ = record.typ
        layout[str(name)] = {
            "type": _render_type(typ, definitions),
            "slot": int(record.pos),
            # These compilers allocate one hashed root per top-level value.
            "n_slots": 1,
        }

    # Reentrancy salts are allocated lazily during code generation.
    if data is not None:
        with contextlib.suppress(Exception):
            _ = data.lll_nodes
    for key, slot in getattr(context, "_nonrentrant_keys", {}).items():
        layout["nonreentrant.{}".format(key)] = {
            "type": "nonreentrant lock",
            "slot": int(slot),
            "n_slots": 1,
        }

    # The beta compiler predates CompilerData. It places unique lock keys at a
    # fixed high offset in first-use order.
    if _version_tuple(_version()) < (0, 2, 0):
        keys = []
        for key in re.findall(
            r"@nonreentrant\(\s*[\"']([^\"']+)[\"']\s*\)",
            request["source"],
        ):
            if key not in keys:
                keys.append(key)
        for index, key in enumerate(keys):
            layout.setdefault(
                "nonreentrant.{}".format(key),
                {
                    "type": "nonreentrant lock",
                    "slot": 0xFFFFFF + index,
                    "n_slots": 1,
                },
            )
    return layout, definitions


def _metadata_position(position):
    for value in (
        position,
        getattr(position, "position", None),
        getattr(position, "slot", None),
    ):
        if isinstance(value, int):
            return value
    raise RuntimeError("could not extract compiler-assigned storage position")


def _annotated_layout(request, data=None, leaf_definitions=None):
    from vyper import ast as vy_ast

    definitions = {}
    if data is None:
        data = _compiler_data(request)
    with contextlib.suppress(AttributeError):
        _ = data.storage_layout
    module = getattr(data, "annotated_vyper_module", None)
    if module is None:
        module = data.vyper_module_folded

    layout = {}
    node_types = [vy_ast.AnnAssign]
    variable_decl = getattr(vy_ast, "VariableDecl", None)
    if variable_decl is not None:
        node_types.append(variable_decl)
    nodes = []
    for node_type in node_types:
        nodes.extend(module.get_children(node_type))
    for node in nodes:
        metadata = getattr(node.target, "_metadata", {})
        varinfo = metadata.get("varinfo")
        typ = metadata.get("type") or (varinfo.typ if varinfo is not None else None)
        if typ is None:
            continue
        position = getattr(typ, "position", None)
        if position is None and varinfo is not None:
            position = varinfo.position
        name = str(node.target.id)
        variable_definitions = {}
        rendered_type = _render_type(typ, variable_definitions)
        definitions.update(variable_definitions)
        if leaf_definitions is not None and variable_definitions:
            leaf_definitions[name] = variable_definitions
        layout[name] = {
            "type": rendered_type,
            "slot": _metadata_position(position),
            "n_slots": _words(typ),
        }

    found_function_locks = False
    for node in module.get_children(vy_ast.FunctionDef):
        function_type = getattr(node, "_metadata", {}).get("type")
        key = getattr(function_type, "nonreentrant", None)
        position = getattr(function_type, "reentrancy_key_position", None)
        if key is None or position is None:
            continue
        found_function_locks = True
        layout["$.nonreentrant.{}@{}".format(key, node.name)] = {
            "type": "nonreentrant lock",
            "slot": _metadata_position(position),
            "n_slots": 1,
        }
    if not found_function_locks:
        try:
            context = data.global_ctx
            _ = data.lll_nodes
            for key, slot in context._nonrentrant_keys.items():
                layout["nonreentrant.{}".format(key)] = {
                    "type": "nonreentrant lock",
                    "slot": int(slot),
                    "n_slots": 1,
                }
        except Exception:
            pass
    return layout, definitions


def _enrich_native_namespace(namespace, annotated, parsed, preserve_types=False):

    def fill_lock_spans(value):
        for item in value.values():
            if not isinstance(item, dict):
                continue
            if item.get("type") == "nonreentrant lock" and "slot" in item:
                item.setdefault("n_slots", 1)
            elif "slot" not in item and "type" not in item:
                fill_lock_spans(item)

    fill_lock_spans(namespace)
    function_lock_keys = {
        name.split(".nonreentrant.", 1)[1].split("@", 1)[0]
        for name in annotated
        if name.startswith("$.nonreentrant.")
    }
    if parsed <= (0, 3, 0):
        for key in function_lock_keys:
            namespace.pop("nonreentrant.{}".format(key), None)
    for name, item in annotated.items():
        if name.startswith("$.nonreentrant.") and parsed <= (0, 3, 0):
            namespace[name] = item
        elif name in namespace and isinstance(namespace[name], dict):
            namespace[name].setdefault("n_slots", item.get("n_slots"))
            # Structured compiler types repair historical HashMap repr bugs.
            if not preserve_types:
                namespace[name]["type"] = item.get(
                    "type", namespace[name].get("type")
                )


def _enrich_native_layout(layout, annotated, parsed):
    namespace = layout.get("storage_layout", layout)
    _enrich_native_namespace(namespace, annotated, parsed)
    return layout


def _split_legacy_transient_layout(layout, data, parsed):
    # Vyper 0.3.8-0.3.10 added transient variables but allocated and reported
    # them in the persistent storage namespace. The AST still records the
    # transient qualifier, so preserve the compiler-assigned slots while
    # separating the two EVM address spaces for Sourcify consumers.
    if not ((0, 3, 8) <= parsed < (0, 4, 0)):
        return layout
    namespace = layout.get("storage_layout")
    if not isinstance(namespace, dict) or data is None:
        return layout

    module = getattr(data, "annotated_vyper_module", None)
    if module is None:
        module = getattr(data, "vyper_module_folded", None)
    if module is None:
        return layout

    from vyper import ast as vy_ast

    transient_names = set()
    node_types = [vy_ast.AnnAssign]
    variable_decl = getattr(vy_ast, "VariableDecl", None)
    if variable_decl is not None:
        node_types.append(variable_decl)
    for node_type in node_types:
        for node in module.get_children(node_type):
            varinfo = getattr(node.target, "_metadata", {}).get("varinfo")
            if getattr(node, "is_transient", False) or getattr(
                varinfo, "is_transient", False
            ):
                transient_names.add(str(node.target.id))

    transient_namespace = {
        name: namespace.pop(name)
        for name in transient_names
        if name in namespace
    }
    if transient_namespace:
        layout["transient_storage_layout"] = transient_namespace
    return layout


def _compiler_data_paths(data):
    file_input = getattr(data, "file_input", None)
    if file_input is None:
        return set()
    return {
        str(value)
        for value in (
            getattr(file_input, "path", None),
            getattr(file_input, "resolved_path", None),
        )
        if value is not None
    }


def _captured_data_by_path(captured):
    result = {}
    for data in captured:
        for path in _compiler_data_paths(data):
            result[path] = data
    return result


def _imported_module_data(data, captured_by_path):
    module = getattr(data, "annotated_vyper_module", None)
    if module is None:
        return
    for node in getattr(module, "body", []):
        import_info = getattr(node, "_metadata", {}).get("import_info")
        if import_info is None:
            continue
        alias = getattr(import_info, "alias", None)
        compiler_input = getattr(import_info, "compiler_input", None)
        if not isinstance(alias, str) or compiler_input is None:
            continue
        paths = (
            getattr(compiler_input, "path", None),
            getattr(compiler_input, "resolved_path", None),
        )
        imported = next(
            (
                captured_by_path[str(path)]
                for path in paths
                if path is not None and str(path) in captured_by_path
            ),
            None,
        )
        if imported is not None:
            yield alias, imported


def _module_leaf_type_definitions(request, layout, target_data, captured, parsed):
    if target_data is None:
        return {}
    root = layout.get("storage_layout", layout)
    captured_by_path = _captured_data_by_path(captured)
    leaf_definitions = {}
    visited = set()

    def visit(namespace, data, prefix):
        marker = (id(data), tuple(prefix))
        if marker in visited:
            return
        visited.add(marker)

        scoped_definitions = {}
        annotated, definitions = _annotated_layout(
            request, data, scoped_definitions
        )
        # Module storage is already represented by the target compiler's
        # native namespace. Only fill omitted spans; its slot and type strings
        # remain the authoritative verified-compilation output.
        _enrich_native_namespace(namespace, annotated, parsed, preserve_types=True)
        if definitions:
            for name in annotated:
                item = namespace.get(name)
                if isinstance(item, dict) and "slot" in item and "type" in item:
                    if name in scoped_definitions:
                        leaf_definitions[".".join([*prefix, name])] = (
                            scoped_definitions[name]
                        )

        for alias, imported in _imported_module_data(data, captured_by_path):
            child = namespace.get(alias)
            if isinstance(child, dict) and "slot" not in child and "type" not in child:
                visit(child, imported, [*prefix, alias])

    for alias, imported in _imported_module_data(target_data, captured_by_path):
        child = root.get(alias)
        if isinstance(child, dict) and "slot" not in child and "type" not in child:
            visit(child, imported, [alias])
    return leaf_definitions


def main():
    request = json.load(sys.stdin)
    request["source"] = request["sources"][request["target"]]["content"]
    version = _version()
    parsed = _version_tuple(version)
    leaf_type_definitions = {}
    if parsed >= (0, 2, 16):
        layout, data, captured = _native_layout(request)
        definitions = {}
        try:
            annotated, definitions = _annotated_layout(
                request, data, leaf_type_definitions
            )
            layout = _enrich_native_layout(layout, annotated, parsed)
            leaf_type_definitions.update(
                _module_leaf_type_definitions(
                    request, layout, data, captured, parsed
                )
            )
        except Exception:
            # The native slot table remains authoritative when optional type
            # enrichment is not possible (for example, an unusual import API).
            pass
        layout = _split_legacy_transient_layout(layout, data, parsed)
        method = "native-layout"
    elif parsed >= (0, 2, 13):
        layout, definitions = _annotated_layout(
            request, leaf_definitions=leaf_type_definitions
        )
        method = "annotated-ast"
    else:
        layout, definitions = _legacy_global_context(request)
        method = "global-context"
    json.dump(
        {
            "schema": "sourcify/vyper-storage-layout/v1",
            "compiler_version": version,
            "layout": layout,
            "type_definitions": definitions,
            "leaf_type_definitions": leaf_type_definitions,
            "method": method,
        },
        sys.stdout,
        sort_keys=True,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        json.dump({"error": "{}: {}".format(type(exc).__name__, exc)}, sys.stdout)
        sys.exit(1)
