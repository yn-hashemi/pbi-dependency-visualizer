(function (global) {
  "use strict";

  const fold = (value) => String(value ?? "").toLocaleLowerCase().normalize("NFKC");
  const objectKey = (item) => `${item.kind}|${fold(item.entity)}|${fold(item.name)}`;

  function unquote(value) {
    return String(value || "").replace(/^['"]|['"]$/g, "").replace(/''/g, "'").trim();
  }

  function parseTmdl(text) {
    const lines = text.split(/\r?\n/);
    const objects = [];
    const definitions = [];
    let table = "";

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const tableMatch = line.match(/^\s*table\s+(.+?)\s*$/i);
      if (tableMatch) {
        table = unquote(tableMatch[1]);
        objects.push({ kind: "Table", entity: table, name: table });
        continue;
      }
      const memberMatch = line.match(/^\s*(measure|column|calculatedColumn)\s+(.+?)(?:\s*=|\s*$)/i);
      if (!memberMatch || !table) continue;

      const kind = /^measure$/i.test(memberMatch[1]) ? "Measure" : "Column";
      const name = unquote(memberMatch[2]);
      objects.push({ kind, entity: table, name });
      if (kind !== "Measure") continue;

      const first = line.match(/^\s*measure\s+.+?\s*=\s*(.*)$/i)?.[1] || "";
      const expression = [first];
      for (let next = index + 1; next < lines.length; next++) {
        if (/^\s*(?:measure|column|calculatedColumn|partition|table)\s+/i.test(lines[next])) break;
        if (/^\s*(?:formatString|displayFolder|description|lineageTag|isHidden|dataType|sortByColumn|annotation)\s*[:=]/i.test(lines[next])) break;
        expression.push(lines[next]);
      }
      definitions.push({ entity: table, name, expression: expression.join("\n") });
    }
    return { objects, definitions };
  }

  function parseBim(text) {
    let model;
    try { model = JSON.parse(text); } catch { return { objects: [], definitions: [] }; }
    const objects = [];
    const definitions = [];
    (model?.model?.tables || model?.tables || []).forEach((table) => {
      const entity = table.name || "";
      objects.push({ kind: "Table", entity, name: entity });
      (table.columns || []).forEach((column) => objects.push({ kind: "Column", entity, name: column.name || "" }));
      (table.measures || []).forEach((measure) => {
        objects.push({ kind: "Measure", entity, name: measure.name || "" });
        const expression = Array.isArray(measure.expression) ? measure.expression.join("\n") : measure.expression;
        if (measure.name && typeof expression === "string") definitions.push({ entity, name: measure.name, expression });
      });
    });
    return { objects, definitions };
  }

  function fromExtractedPaths(file) {
    const parts = file.path.split("/");
    const tablesIndex = parts.findIndex((part) => part.toLowerCase() === "tables");
    if (tablesIndex < 0 || !parts[tablesIndex + 1]) return null;
    const memberGroup = parts[tablesIndex + 2]?.toLowerCase();
    if (memberGroup !== "columns" && memberGroup !== "measures") return null;
    const name = file.name.replace(/\.(json|dax|txt)$/i, "");
    if (!name || /^table$/i.test(name)) return null;
    const kind = memberGroup === "columns" ? "Column" : "Measure";
    const result = { objects: [{ kind, entity: unquote(parts[tablesIndex + 1]), name: unquote(name) }], definitions: [] };
    if (kind === "Measure" && /\.dax$/i.test(file.name)) result.definitions.push({ entity: unquote(parts[tablesIndex + 1]), name: unquote(name), expression: file.text });
    return result;
  }

  function parseFiles(files) {
    const objects = [];
    const definitions = [];
    files.forEach((file) => {
      let parsed = null;
      if (/\.tmdl$/i.test(file.name)) parsed = parseTmdl(file.text);
      else if (/\.bim$/i.test(file.name) || /model\.json$/i.test(file.name)) parsed = parseBim(file.text);
      else parsed = fromExtractedPaths(file);
      if (!parsed) return;
      objects.push(...parsed.objects);
      definitions.push(...parsed.definitions);
    });
    const uniqueObjects = Array.from(new Map(objects.filter((item) => item.entity && item.name).map((item) => [objectKey(item), item])).values());
    const byKey = new Map(uniqueObjects.map((item) => [objectKey(item), item]));
    const measuresByName = new Map();
    uniqueObjects.filter((item) => item.kind === "Measure").forEach((item) => {
      const found = measuresByName.get(fold(item.name)) || [];
      found.push(item);
      measuresByName.set(fold(item.name), found);
    });

    const edges = [];
    definitions.forEach((definition) => {
      const from = { kind: "Measure", entity: definition.entity, name: definition.name };
      const fromKey = objectKey(from);
      const found = new Map();
      const qualified = /(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_ ]*))\s*\[([^\]]+)\]/g;
      let match;
      while ((match = qualified.exec(definition.expression)) !== null) {
        const entity = unquote(match[1] || match[2]);
        const name = unquote(match[3]);
        const target = ["Column", "Measure"].map((kind) => byKey.get(objectKey({ kind, entity, name }))).find(Boolean);
        if (target && objectKey(target) !== fromKey) found.set(objectKey(target), target);
      }
      const unqualified = /\[([^\]]+)\]/g;
      while ((match = unqualified.exec(definition.expression)) !== null) {
        (measuresByName.get(fold(unquote(match[1]))) || []).forEach((target) => {
          if (objectKey(target) !== fromKey) found.set(objectKey(target), target);
        });
      }
      found.forEach((to) => edges.push({ from, to }));
    });
    return { objects: uniqueObjects, definitions, edges };
  }

  global.PbiModelParser = { parseFiles, objectKey, fold };
})(window);
