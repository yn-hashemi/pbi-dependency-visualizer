(function () {
  "use strict";

  const state = { index: null, query: "", kind: "all", reportId: "all", selectedKey: "", view: "table" };
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat("fa-IR");
  const keyOf = PbiIndexer.objectKey;
  const fold = PbiIndexer.fold;
  const kinds = ["all", "Table", "Column", "Measure"];
  const kindLabels = { all: "همه", Table: "جدول‌ها", Column: "ستون‌ها", Measure: "مژرها" };

  function fieldLabel(item) {
    if (item.kind === "Table") return item.entity || item.name;
    return `${item.entity}[${item.name}]`;
  }

  function usagesFor(item) {
    if (!item || !state.index) return [];
    const targetKey = keyOf(item);
    const found = new Map();
    if (item.kind === "Table") {
      state.index.catalog.filter((member) => member.kind !== "Table" && fold(member.entity) === fold(item.name)).forEach((member) => {
        usagesFor(member).forEach((usage) => found.set(usage.id, usage));
      });
    }
    state.index.usages.forEach((usage) => {
      if (keyOf(usage) === targetKey && (state.reportId === "all" || usage.reportId === state.reportId)) found.set(usage.id, { ...usage, dependencyPath: [] });
    });

    const reverse = new Map();
    state.index.modelEdges.forEach((edge) => {
      const next = reverse.get(keyOf(edge.to)) || [];
      next.push(edge.from);
      reverse.set(keyOf(edge.to), next);
    });
    const queue = [{ item, path: [] }];
    const visited = new Set([targetKey]);
    while (queue.length) {
      const current = queue.shift();
      (reverse.get(keyOf(current.item)) || []).forEach((measure) => {
        const measureKey = keyOf(measure);
        if (visited.has(measureKey)) return;
        visited.add(measureKey);
        const path = [...current.path, measure.name];
        queue.push({ item: measure, path });
        state.index.usages.forEach((usage) => {
          if (usage.kind !== "Measure" || keyOf(usage) !== measureKey || (state.reportId !== "all" && usage.reportId !== state.reportId)) return;
          if (found.has(usage.id)) return;
          found.set(usage.id, { ...usage, dependencyPath: path });
        });
      });
    }
    return Array.from(found.values()).sort((a, b) => a.reportName.localeCompare(b.reportName) || a.pageName.localeCompare(b.pageName) || a.visualName.localeCompare(b.visualName));
  }

  function filteredCatalog() {
    if (!state.index) return [];
    const query = fold(state.query.trim());
    return state.index.catalog.filter((item) => {
      if (state.kind !== "all" && item.kind !== state.kind) return false;
      const uses = usagesFor(item);
      if (state.reportId !== "all" && item.kind !== "Table" && item.kind !== "Column" && item.kind !== "Measure" && !uses.length) return false;
      if (!query) return true;
      const searchInObject = fold(`${item.kind} ${item.entity} ${item.name} ${fieldLabel(item)}`).includes(query);
      const searchInUsage = uses.some((usage) => fold(`${usage.reportName} ${usage.pageName} ${usage.visualName} ${usage.visualType} ${usage.roles.join(" ")}`).includes(query));
      return searchInObject || searchInUsage;
    });
  }

  function selectedItem() {
    const items = filteredCatalog();
    return items.find((item) => keyOf(item) === state.selectedKey) || items[0] || null;
  }

  function updateReportFilter() {
    const select = $("report-filter");
    const current = state.reportId;
    select.replaceChildren();
    const all = document.createElement("option");
    all.value = "all"; all.textContent = "همه‌ی گزارش‌ها"; select.append(all);
    (state.index?.reports || []).forEach((report) => {
      const option = document.createElement("option");
      option.value = report.id; option.textContent = report.name; select.append(option);
    });
    state.reportId = (state.index?.reports || []).some((report) => report.id === current) || current === "all" ? current : "all";
    select.value = state.reportId;
  }

  function renderTabs() {
    const root = $("kind-tabs");
    root.replaceChildren();
    kinds.forEach((kind) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `kind-tab${state.kind === kind ? " active" : ""}`;
      button.textContent = kindLabels[kind];
      button.setAttribute("aria-pressed", String(state.kind === kind));
      button.addEventListener("click", () => { state.kind = kind; state.selectedKey = ""; render(); });
      root.append(button);
    });
  }

  function objectCounts(item) {
    const direct = item.kind === "Table"
      ? state.index.usages.filter((usage) => fold(usage.entity) === fold(item.name) && (state.reportId === "all" || usage.reportId === state.reportId)).length
      : state.index.usages.filter((usage) => keyOf(usage) === keyOf(item) && (state.reportId === "all" || usage.reportId === state.reportId)).length;
    const total = usagesFor(item).length;
    return { direct, total, indirect: Math.max(0, total - direct) };
  }

  function renderCatalog() {
    const root = $("field-list");
    root.replaceChildren();
    const items = filteredCatalog();
    $("field-count").textContent = `${fmt.format(items.length)} مورد`;
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "blank-state";
      empty.textContent = state.index ? "موردی مطابق این فیلتر پیدا نشد." : "برای شروع، پوشه‌ی Extracted Dashboards را بارگذاری کنید.";
      root.append(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      const count = objectCounts(item);
      const row = document.createElement("button");
      row.type = "button";
      row.className = `field-row${state.selectedKey === keyOf(item) ? " selected" : ""}`;
      row.setAttribute("aria-current", String(state.selectedKey === keyOf(item)));
      const identity = document.createElement("span"); identity.className = "field-identity";
      const type = document.createElement("span"); type.className = `type-mark ${item.kind.toLowerCase()}`; type.textContent = item.kind === "Table" ? "T" : item.kind === "Column" ? "C" : "M";
      const text = document.createElement("span"); text.className = "field-text";
      const label = document.createElement("span"); label.className = "field-label"; label.textContent = item.kind === "Table" ? item.name : item.name;
      const entity = document.createElement("span"); entity.className = "field-entity"; entity.textContent = item.kind === "Table" ? "جدول" : item.entity;
      text.append(label, entity); identity.append(type, text);
      const uses = document.createElement("span"); uses.className = "use-count"; uses.textContent = fmt.format(count.total); uses.title = `${fmt.format(count.direct)} استفاده‌ی مستقیم، ${fmt.format(count.indirect)} استفاده‌ی غیرمستقیم`;
      row.append(identity, uses);
      row.addEventListener("click", () => { state.selectedKey = keyOf(item); render(); });
      fragment.append(row);
    });
    root.append(fragment);
  }

  function renderSummary(item, uses) {
    const root = $("selection-summary"); root.replaceChildren();
    if (!item) { $("selected-name").textContent = "موردی انتخاب نشده"; $("selected-subtitle").textContent = ""; return; }
    $("selected-name").textContent = item.name;
    $("selected-subtitle").textContent = item.kind === "Table" ? "جدول مدل" : `${item.entity} · ${item.kind === "Measure" ? "مژر" : "ستون"}`;
    const direct = item.kind === "Table"
      ? state.index.usages.filter((usage) => fold(usage.entity) === fold(item.name) && (state.reportId === "all" || usage.reportId === state.reportId)).length
      : state.index.usages.filter((usage) => keyOf(usage) === keyOf(item) && (state.reportId === "all" || usage.reportId === state.reportId)).length;
    const statItems = [
      [fmt.format(uses.length), "محل استفاده"],
      [fmt.format(direct), "ارجاع مستقیم"],
      [fmt.format(Math.max(0, uses.length - direct)), "از طریق Measure"]
    ];
    statItems.forEach(([value, label]) => {
      const box = document.createElement("div"); box.className = "detail-stat";
      const strong = document.createElement("strong"); strong.textContent = value;
      const span = document.createElement("span"); span.textContent = label;
      box.append(strong, span); root.append(box);
    });
    const status = document.createElement("div");
    status.className = `detail-status${uses.length ? " in-use" : " no-use"}`;
    status.textContent = uses.length
      ? `در ${fmt.format(uses.length)} محل از ورودی‌های فعلی استفاده شده`
      : state.index.definitions.length
        ? "در ورودی‌های فعلی ارجاعی پیدا نشد"
        : "میزان استفاده نامشخص؛ metadata مدل بارگذاری نشده";
    root.append(status);
  }

  function makeCell(value, className = "") {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = value || "—";
    return cell;
  }

  function renderUsageTable(uses) {
    const body = $("usage-body"); body.replaceChildren();
    if (!uses.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td"); cell.className = "empty-cell"; cell.colSpan = 6;
      cell.textContent = state.index?.definitions.length ? "در گزارش‌های بارگذاری‌شده ارجاعی پیدا نشد." : "ارجاع مستقیمی در visualها پیدا نشد. برای نتیجه‌ی قطعی‌تر، مدل Tabular/TMDL همه‌ی PBIXها را هم بارگذاری کنید.";
      row.append(cell); body.append(row); return;
    }
    const rows = document.createDocumentFragment();
    uses.forEach((usage) => {
      const row = document.createElement("tr");
      const pathLines = [];
      if (usage.roles.length) pathLines.push(`نقش: ${usage.roles.join("، ")}`);
      if (usage.dependencyPath?.length) pathLines.push(`مسیر Measure: ${usage.dependencyPath.join(" ← ")}`);
      if (!pathLines.length) pathLines.push("فیلد در query یا فیلتر visual");
      const visualCell = document.createElement("td");
      visualCell.className = "visual-cell";
      const visualName = document.createElement("strong"); visualName.textContent = usage.visualName;
      visualCell.append(visualName);
      if (usage.groupHierarchy?.length) {
        const groupPath = document.createElement("span");
        groupPath.className = "group-path";
        groupPath.textContent = `گروه Selection: ${usage.groupHierarchy.join("  ‹  ")}`;
        visualCell.append(groupPath);
      }
      const pathCell = makeCell(pathLines.join("\n"), "path-cell");
      pathCell.dir = "auto";
      row.append(makeCell(usage.reportName), makeCell(usage.pageName), visualCell, makeCell(usage.visualType, "visual-type ltr"), pathCell, makeCell(usage.approximatePosition, "approx-position"));
      rows.append(row);
    });
    body.append(rows);
  }

  function renderPathGraph(uses, item) {
    const viewport = $("path-viewport"); viewport.replaceChildren();
    if (!uses.length || !item) {
      const empty = document.createElement("div"); empty.className = "path-empty"; empty.textContent = "برای این مورد مسیری در گزارش‌ها یافت نشد."; viewport.append(empty); return;
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("path-svg");
    const width = 1060, rowHeight = 78, height = 56 + uses.length * rowHeight;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`); svg.setAttribute("width", width); svg.setAttribute("height", height);
    const columns = [95, 335, 575, 820];
    const headings = ["گزارش / PBIX", "صفحه", "Visual · نوع", "فیلد / وابستگی"];
    headings.forEach((label, index) => {
      const title = document.createElementNS(svg.namespaceURI, "text"); title.setAttribute("x", columns[index]); title.setAttribute("y", 23); title.setAttribute("class", "graph-heading"); title.textContent = label; svg.append(title);
    });
    uses.forEach((usage, index) => {
      const y = 54 + index * rowHeight;
      for (let edge = 0; edge < 3; edge++) {
        const line = document.createElementNS(svg.namespaceURI, "line"); line.setAttribute("x1", columns[edge] + 11); line.setAttribute("x2", columns[edge + 1] - 11); line.setAttribute("y1", y); line.setAttribute("y2", y); line.setAttribute("class", "graph-edge"); svg.append(line);
      }
      const values = [usage.reportName, usage.pageName, `${usage.visualName} · ${usage.visualType}`, usage.dependencyPath?.length ? `${item.entity}[${item.name}] ← ${usage.dependencyPath.join(" ← ")}` : fieldLabel(item)];
      values.forEach((value, level) => {
        const circle = document.createElementNS(svg.namespaceURI, "circle"); circle.setAttribute("cx", columns[level]); circle.setAttribute("cy", y); circle.setAttribute("r", "7"); circle.setAttribute("class", `graph-dot level-${level}`); svg.append(circle);
        const text = document.createElementNS(svg.namespaceURI, "text"); text.setAttribute("x", columns[level]); text.setAttribute("y", y + 24); text.setAttribute("text-anchor", "middle"); text.setAttribute("class", "graph-label"); text.textContent = value.length > 36 ? `${value.slice(0, 35)}…` : value; svg.append(text);
      });
    });
    viewport.append(svg);
  }

  function renderDetails() {
    const item = selectedItem();
    const uses = usagesFor(item);
    renderSummary(item, uses);
    renderUsageTable(uses);
    renderPathGraph(uses, item);
    $("usage-count").textContent = `${fmt.format(uses.length)} محل`;
    $("coverage-note").hidden = !item || Boolean(state.index?.definitions.length);
    if (item && !state.index?.definitions.length) $("coverage-note").textContent = "تعریف DAX مدل در فایل‌های انتخابی وجود ندارد؛ استفاده‌های مستقیم گزارش دیده می‌شوند، اما نتیجه‌ی Unused برای ستون‌ها قطعی نیست.";
  }

  function renderStats() {
    const index = state.index;
    $("stat-reports").textContent = fmt.format(index?.reports.length || 0);
    $("stat-pages").textContent = fmt.format(index?.pages.length || 0);
    $("stat-objects").textContent = fmt.format(index?.catalog.length || 0);
    $("stat-locations").textContent = fmt.format(index?.usages.length || 0);
    $("folder-state").textContent = index ? `${fmt.format(index.reports.length)} گزارش · ${fmt.format(index.catalog.length)} شیء مدل` : "در انتظار پوشه‌ی استخراج‌شده";
  }

  function render() {
    updateReportFilter();
    renderTabs();
    const items = filteredCatalog();
    if (!items.some((item) => keyOf(item) === state.selectedKey)) state.selectedKey = items[0] ? keyOf(items[0]) : "";
    renderCatalog();
    renderDetails();
    renderStats();
  }

  $("folder-input").addEventListener("change", async (event) => {
    const files = Array.from(event.currentTarget.files || []).filter((file) => /\.(json|bim|tmdl|dax|txt)$/i.test(file.name));
    $("folder-state").textContent = "در حال خواندن فایل‌های محلی…";
    try {
      const loaded = await Promise.all(files.map(async (file) => ({ path: (file.webkitRelativePath || file.name).replace(/\\/g, "/"), name: file.name, text: await file.text() })));
      state.index = PbiIndexer.build(loaded);
      state.selectedKey = "";
      render();
    } catch (error) {
      $("folder-state").textContent = `خواندن ناموفق بود: ${error.message}`;
    }
  });
  $("search-input").addEventListener("input", (event) => { state.query = event.currentTarget.value; state.selectedKey = ""; render(); });
  $("report-filter").addEventListener("change", (event) => { state.reportId = event.currentTarget.value; state.selectedKey = ""; render(); });
  $("clear-button").addEventListener("click", () => { state.query = ""; state.kind = "all"; state.reportId = "all"; state.selectedKey = ""; $("search-input").value = ""; render(); });
  $("view-table").addEventListener("click", () => { state.view = "table"; setView(); });
  $("view-graph").addEventListener("click", () => { state.view = "graph"; setView(); });

  function setView() {
    $("view-table").classList.toggle("active", state.view === "table");
    $("view-graph").classList.toggle("active", state.view === "graph");
    $("usage-table-wrap").hidden = state.view !== "table";
    $("path-viewport").hidden = state.view !== "graph";
  }

  render();
  setView();
})();
