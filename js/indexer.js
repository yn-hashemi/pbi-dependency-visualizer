(function (global) {
  "use strict";

  const { parseFiles: parseModelFiles, objectKey, fold } = global.PbiModelParser;
  const base = (path) => path.split("/").pop() || path;
  const cleanName = (name) => name.replace(/^\d+[_\s-]*/, "").replace(/\s*\([0-9a-f]{4,}\)$/i, "").replace(/_/g, " ").trim() || name;
  const json = (file) => { try { return JSON.parse(file.text); } catch { return null; } };

  function reportLocation(path) {
    const parts = path.split("/");
    const reportAt = parts.findIndex((part) => part.toLowerCase() === "report");
    if (reportAt < 0) return null;
    const root = parts.slice(0, reportAt).join("/") || parts[0] || "PBIX";
    return { parts, reportAt, root, name: base(root) };
  }

  function walkReferences(value, aliases, result) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach((item) => walkReferences(item, aliases, result)); return; }
    ["Measure", "Column"].forEach((kind) => {
      const reference = value[kind];
      if (!reference?.Property) return;
      const source = reference.Expression?.SourceRef?.Source;
      const entity = reference.Expression?.SourceRef?.Entity || aliases.get(source) || "";
      result.push({ kind, entity, name: reference.Property });
    });
    Object.values(value).forEach((child) => walkReferences(child, aliases, result));
  }

  function visualReferences(queryFile, config) {
    const roots = (queryFile?.Commands || []).map((command) => command?.SemanticQueryDataShapeCommand?.Query).filter(Boolean);
    if (config?.singleVisual?.prototypeQuery) roots.push(config.singleVisual.prototypeQuery);
    const references = [];
    roots.forEach((root) => {
      const aliases = new Map((root.From || []).map((source) => [source.Name, source.Entity]));
      walkReferences(root, aliases, references);
    });
    return Array.from(new Map(references.map((item) => [`${objectKey(item)}`, item])).values());
  }

  function parseFilters(document) {
    const aliases = new Map();
    const collect = (value) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(collect); return; }
      if (value.Name && value.Entity) aliases.set(value.Name, value.Entity);
      Object.values(value).forEach(collect);
    };
    collect(document);
    const references = [];
    walkReferences(document, aliases, references);
    return Array.from(new Map(references.map((item) => [objectKey(item), item])).values());
  }

  function rolesByQueryRef(config) {
    const roles = new Map();
    Object.entries(config?.singleVisual?.projections || {}).forEach(([role, fields]) => {
      (Array.isArray(fields) ? fields : []).forEach((field) => {
        if (!field.queryRef) return;
        const current = roles.get(field.queryRef) || [];
        current.push(role);
        roles.set(field.queryRef, current);
      });
    });
    return roles;
  }

  function titleFromConfig(visual) {
    for (const entry of visual?.objects?.title || []) {
      const value = entry?.properties?.text?.expr?.Literal?.Value;
      if (typeof value === "string" && value.trim()) return value.replace(/^'|'$/g, "").replace(/''/g, "'");
    }
    return "";
  }

  function positionFrom(config, geometry) {
    const position = config?.layouts?.[0]?.position || {};
    return { ...(geometry || {}), ...position };
  }

  function approximatePosition(position, page) {
    const pageWidth = Number(page?.width) || 1280;
    const pageHeight = Number(page?.height) || 720;
    const x = Number(position?.x);
    const y = Number(position?.y);
    const width = Number(position?.width) || 0;
    const height = Number(position?.height) || 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return "نامشخص";
    const horizontal = x + width / 2 < pageWidth / 3 ? "چپ" : x + width / 2 < pageWidth * 2 / 3 ? "میانه" : "راست";
    const vertical = y + height / 2 < pageHeight / 3 ? "بالا" : y + height / 2 < pageHeight * 2 / 3 ? "میانه" : "پایین";
    return vertical === "میانه" && horizontal === "میانه" ? "مرکز صفحه" : `${vertical}، ${horizontal} صفحه`;
  }

  function build(files) {
    const model = parseModelFiles(files);
    const reports = new Map();
    const pagesById = new Map();
    const visualFiles = new Map();
    const connections = new Map();
    files.forEach((file) => {
      if (base(file.path).toLowerCase() !== "connections.json") return;
      const connection = json(file)?.Connections?.[0];
      if (!connection) return;
      const root = file.path.split("/").slice(0, -1).join("/");
      connections.set(root, `${connection.ConnectionType || ""}${connection.ConnectionString ? ` · ${connection.ConnectionString}` : ""}`);
    });

    files.forEach((file) => {
      const location = reportLocation(file.path);
      if (!location) return;
      if (!reports.has(location.root)) reports.set(location.root, { id: location.root, name: location.name, connection: connections.get(location.root) || "", filters: null });
      const report = reports.get(location.root);
      const sectionsAt = location.parts.findIndex((part, index) => index > location.reportAt && part.toLowerCase() === "sections");
      if (sectionsAt < 0 || !location.parts[sectionsAt + 1]) {
        if (base(file.path).toLowerCase() === "filters.json") report.filters = json(file);
        return;
      }

      const pageFolder = location.parts[sectionsAt + 1];
      const pageId = `${location.root}/Report/sections/${pageFolder}`;
      if (!pagesById.has(pageId)) pagesById.set(pageId, { id: pageId, reportId: location.root, folder: pageFolder, name: cleanName(pageFolder), width: null, height: null, filters: null });
      const page = pagesById.get(pageId);
      const filename = base(file.path).toLowerCase();
      if (filename === "section.json") {
        const section = json(file) || {};
        page.name = section.displayName || page.name;
        page.width = section.width || null;
        page.height = section.height || null;
      }
      const visualAt = location.parts.findIndex((part, index) => index > sectionsAt && part.toLowerCase() === "visualcontainers");
      if (visualAt < 0) {
        if (filename === "filters.json") page.filters = json(file);
        return;
      }
      if (visualAt === sectionsAt + 1 || !location.parts[visualAt + 1]) return;
      const folder = location.parts[visualAt + 1];
      const visualId = location.parts.slice(0, visualAt + 2).join("/");
      if (!visualFiles.has(visualId)) visualFiles.set(visualId, { id: visualId, reportId: location.root, pageId, folder, config: null, query: null, geometry: null, filters: null });
      const visual = visualFiles.get(visualId);
      const document = json(file);
      if (filename === "config.json") visual.config = document;
      if (filename === "query.json") visual.query = document;
      if (filename === "visualcontainer.json") visual.geometry = document;
      if (filename === "filters.json") visual.filters = document;
    });

    const pages = Array.from(pagesById.values()).map((page) => ({ ...page, reportName: reports.get(page.reportId)?.name || "" }));
    const groupsByPage = new Map();
    visualFiles.forEach((item) => {
      const config = item.config || {};
      const group = config.singleVisualGroup;
      if (!group || !config.name) return;
      const groups = groupsByPage.get(item.pageId) || new Map();
      groups.set(config.name, { id: config.name, name: group.displayName || cleanName(item.folder), parentId: config.parentGroupName || "" });
      groupsByPage.set(item.pageId, groups);
    });

    const hierarchyFor = (item) => {
      const chain = [];
      const groups = groupsByPage.get(item.pageId);
      let parentId = item.config?.parentGroupName || "";
      const visited = new Set();
      while (parentId && groups?.has(parentId) && !visited.has(parentId)) {
        visited.add(parentId);
        const group = groups.get(parentId);
        chain.unshift(group.name);
        parentId = group.parentId;
      }
      return chain;
    };

    const usages = [];
    const visuals = [];
    const addUsages = (references, context, roleMap = new Map(), visual = null) => {
      references.forEach((reference) => {
        const fullName = reference.entity ? `${reference.entity}.${reference.name}` : reference.name;
        const roles = Array.from(roleMap.entries()).filter(([queryRef]) => queryRef === fullName || queryRef.endsWith(`.${reference.name}`)).flatMap(([, items]) => items);
        usages.push({
          id: `${context.id}|${context.kind}|${objectKey(reference)}`,
          kind: reference.kind, entity: reference.entity, name: reference.name,
          displayName: visual?.config?.singleVisual?.columnProperties?.[fullName]?.displayName || reference.name,
          reportId: context.reportId, reportName: reports.get(context.reportId)?.name || "(مدل)", connection: reports.get(context.reportId)?.connection || "",
          pageId: context.pageId || "", pageName: pagesById.get(context.pageId)?.name || context.pageName || "—",
          visualId: context.id, visualName: context.name, visualType: context.type,
          groupHierarchy: context.groupHierarchy || [],
          roles: context.filter ? ["Filter"] : roles, position: context.position || {},
          approximatePosition: context.approximatePosition || "نامشخص",
          viaMeasure: context.viaMeasure || ""
        });
      });
    };

    visualFiles.forEach((item) => {
      const config = item.config || {};
      const single = config.singleVisual || {};
      const group = config.singleVisualGroup || {};
      const name = group.displayName || single.displayName || titleFromConfig(single) || cleanName(item.folder);
      const type = single.visualType || (group.displayName ? "Group" : "Unknown");
      const position = positionFrom(config, item.geometry);
      const page = pagesById.get(item.pageId);
      const groupHierarchy = group.displayName ? [...hierarchyFor(item), name] : hierarchyFor(item);
      const approximate = approximatePosition(position, page);
      const references = visualReferences(item.query, config);
      const visual = { id: item.id, reportId: item.reportId, pageId: item.pageId, name, type, position, groupHierarchy, approximatePosition: approximate, references };
      visuals.push(visual);
      addUsages(references, { id: item.id, reportId: item.reportId, pageId: item.pageId, name, type, position, groupHierarchy, approximatePosition: approximate }, rolesByQueryRef(config), item);
      if (item.filters) addUsages(parseFilters(item.filters), { id: `${item.id}|filter`, reportId: item.reportId, pageId: item.pageId, name: `${name} · فیلتر`, type: "Visual filter", position, groupHierarchy, approximatePosition: approximate, filter: true });
    });

    pagesById.forEach((page) => {
      if (page.filters) addUsages(parseFilters(page.filters), { id: `${page.id}|filter`, reportId: page.reportId, pageId: page.id, name: "فیلترهای صفحه", type: "Page filter", filter: true });
    });
    reports.forEach((report) => {
      if (report.filters) addUsages(parseFilters(report.filters), { id: `${report.id}|filter`, reportId: report.id, name: "فیلترهای گزارش", type: "Report filter", filter: true });
    });

    const catalog = new Map(model.objects.map((item) => [objectKey(item), { ...item, source: "model" }]));
    usages.forEach((usage) => {
      const key = objectKey(usage);
      if (usage.entity && usage.name && !catalog.has(key)) catalog.set(key, { kind: usage.kind, entity: usage.entity, name: usage.name, source: "report" });
    });
    const sortedUsages = usages.sort((a, b) => a.reportName.localeCompare(b.reportName) || a.pageName.localeCompare(b.pageName) || a.visualName.localeCompare(b.visualName));
    return {
      reports: Array.from(reports.values()).sort((a, b) => a.name.localeCompare(b.name)),
      pages,
      visuals,
      usages: sortedUsages,
      catalog: Array.from(catalog.values()).sort((a, b) => a.entity.localeCompare(b.entity) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
      modelEdges: model.edges,
      definitions: model.definitions
    };
  }

  global.PbiIndexer = { build, objectKey, fold };
})(window);
