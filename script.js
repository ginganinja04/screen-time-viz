// 20 distinct colors (no repeats for TopN up to 20)
const PALETTE_20 = [
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
  "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
  "#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#b07aa1",
  "#9c755f", "#edc949", "#76b7b2", "#ff9da7", "#bab0ab"
];

// Stores a stable assignment: appName -> palette index (0..19)
const appColorMap = new Map();

function getAppColor(appName, visibleApps) {
  // Track colors already used by visible apps (so visible set is unique)
  const used = new Set();
  for (const a of visibleApps) {
    if (appColorMap.has(a)) used.add(appColorMap.get(a));
  }

  // If app already assigned, keep it
  if (appColorMap.has(appName)) {
    return PALETTE_20[appColorMap.get(appName)];
  }

  // Otherwise pick the first unused palette slot among visible apps
  for (let i = 0; i < PALETTE_20.length; i++) {
    if (!used.has(i)) {
      appColorMap.set(appName, i);
      return PALETTE_20[i];
    }
  }

  // If somehow all colors are used, fall back (shouldn't happen with max N = 20)
  const fallback = 0;
  appColorMap.set(appName, fallback);
  return PALETTE_20[fallback];
}



// -------- Helpers --------
function parseHMS_toMinutes(hms) {
  // Handles "H:MM:SS" or "MM:SS"
  const parts = String(hms).split(":").map(Number);
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 60 + m + s / 60;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return m + s / 60;
  }
  return Number(hms);
}

function formatMinutes(mins) {
  const totalSeconds = Math.round(mins * 60);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h <= 0) return `${m} min`;
  return `${h} hr ${m} min`;
}

function toISODate(mdy) {
  // "1/12/2026" -> "2026-01-12"
  const [mm, dd, yyyy] = mdy.split("/").map(Number);
  const d = new Date(yyyy, mm - 1, dd);
  return d.toISOString().slice(0, 10);
}

// -------- State --------
const state = {
  data: [],
  category: "All",
  startDate: null,
  endDate: null,
  topN: 10,
  selectedApp: null
};

// -------- Init --------
(async function init() {
  const raw = await d3.csv("data.csv");

  const data = raw.map(d => ({
    dateStr: d.Date,
    dateISO: toISODate(d.Date),
    app: d.App,
    category: d.Category,
    minutes: parseHMS_toMinutes(d.Minutes)
  }));

  state.data = data;

  // Populate controls
  const categories = Array.from(new Set(data.map(d => d.category))).sort();
  categories.unshift("All");

  const dates = Array.from(new Set(data.map(d => d.dateISO))).sort();

  state.startDate = dates[0];
  state.endDate = dates[dates.length - 1];

  setupControls(categories, dates);
  render();
})();

function setupControls(categories, dates) {
  const categorySelect = d3.select("#categorySelect");
  categorySelect
    .selectAll("option")
    .data(categories)
    .join("option")
    .attr("value", d => d)
    .text(d => d);

  categorySelect.on("change", (event) => {
    state.category = event.target.value;
    state.selectedApp = null;
    render();
  });

  const startSelect = d3.select("#startDateSelect");
  const endSelect = d3.select("#endDateSelect");

  startSelect.selectAll("option")
  .data(dates)
  .join("option")
  .attr("value", d => d)
  .text(d => {
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric"
    }).replace(",", " -");
  });

endSelect.selectAll("option")
  .data(dates)
  .join("option")
  .attr("value", d => d)
  .text(d => {
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric"
    }).replace(",", " -");
  });


  startSelect.on("change", (event) => {
    state.startDate = event.target.value;
    clampDateRange();
    state.selectedApp = null;
    render();
  });

  endSelect.on("change", (event) => {
    state.endDate = event.target.value;
    if (state.endDate < state.startDate) {
      state.startDate = state.endDate;
      startSelect.property("value", state.startDate);
    }
    state.selectedApp = null;
    render();
  });

  const slider = d3.select("#topNSlider");
  const topNValue = d3.select("#topNValue");
  slider.on("input", (event) => {
    state.topN = +event.target.value;
    topNValue.text(state.topN);
    render();
  });
}

function getFilteredData() {
  return state.data.filter(d => {
    const inDate = d.dateISO >= state.startDate && d.dateISO <= state.endDate;
    const inCat = (state.category === "All") || (d.category === state.category);
    return inDate && inCat;
  });
}

// -------- Main Render --------
function render() {
  const filtered = getFilteredData();

  // Aggregate total minutes by app
  const totals = d3.rollups(
    filtered,
    v => d3.sum(v, d => d.minutes),
    d => d.app
  )
  .map(([app, minutes]) => ({ app, minutes }))
  .sort((a, b) => d3.descending(a.minutes, b.minutes))
  .slice(0, state.topN);

  drawBarChart(totals, filtered);

  if (state.selectedApp && totals.some(d => d.app === state.selectedApp)) {
    renderDetails(state.selectedApp, filtered);
  } else {
    renderDetails(null, filtered);
  }
}

// -------- Chart --------
function drawBarChart(totals, filtered) {
  const container = d3.select("#chart");
  container.selectAll("*").remove();

  const tooltip = d3.select("#tooltip");

  const margin = { top: 10, right: 20, bottom: 40, left: 140 };
  const width = Math.min(900, container.node().clientWidth) - margin.left - margin.right;
  const height = Math.max(320, totals.length * 34) - margin.top - margin.bottom;

  const svg = container.append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear()
    .domain([0, d3.max(totals, d => d.minutes) || 1])
    .nice()
    .range([0, width]);

  const y = d3.scaleBand()
    .domain(totals.map(d => d.app))
    .range([0, height])
    .padding(0.25);

  // X axis (hours labels)
  const xAxis = d3.axisBottom(x)
    .ticks(6)
    .tickFormat(d => `${Math.round(d / 60)}h`);

  g.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(xAxis);

  // Y axis
  g.append("g").call(d3.axisLeft(y));

  // Visible apps (used to keep colors unique in the current Top N)
  const visibleApps = totals.map(d => d.app);

  // Bars
  g.selectAll("rect")
    .data(totals, d => d.app)
    .join("rect")
    .attr("x", 0)
    .attr("y", d => y(d.app))
    .attr("height", y.bandwidth())
    .attr("width", d => x(d.minutes))
    .attr("rx", 6)
    .attr("fill", d => getAppColor(d.app, visibleApps)) // ✅ consistent by app + unique in visible set
    .attr("stroke", "rgba(0,0,0,0.08)")
    .attr("opacity", d => (state.selectedApp && d.app !== state.selectedApp) ? 0.35 : 1)
    .on("mousemove", (event, d) => {
      const appRows = filtered.filter(r => r.app === d.app);
      const byCategory = d3.rollups(
        appRows,
        v => d3.sum(v, r => r.minutes),
        r => r.category
      )
        .sort((a, b) => d3.descending(a[1], b[1]))
        .slice(0, 3);

      const catLines = byCategory
        .map(([cat, mins]) => `${cat}: ${formatMinutes(mins)}`)
        .join("<br/>");

      tooltip
        .style("opacity", 1)
        .html(
          `<strong>${d.app}</strong><br/>
           Total: ${formatMinutes(d.minutes)}<br/>
           <span style="color:#ccc">Top categories:</span><br/>${catLines}`
        )
        .style("left", `${event.pageX + 14}px`)
        .style("top", `${event.pageY - 10}px`);
    })
    .on("mouseleave", () => tooltip.style("opacity", 0))
    .on("click", (_, d) => {
      state.selectedApp = (state.selectedApp === d.app) ? null : d.app;
      render();
    });
}



// -------- Details Panel + Mini Chart --------
function renderDetails(app, filtered) {
  const panel = d3.select("#details");
  const mini = d3.select("#miniChart");
  mini.selectAll("*").remove();

  if (!app) {
    panel.html(`<h2>Click a bar</h2><p>Select an app to see details here.</p><div id="miniChart"></div>`);
    return;
  }

  // Match mini chart color to selected app
  const allApps = Array.from(new Set(state.data.map(d => d.app)));
  const appFill = getAppColor(app, allApps);

  const rows = filtered.filter(d => d.app === app);
  const total = d3.sum(rows, d => d.minutes);

  const dates = Array.from(new Set(filtered.map(d => d.dateISO))).sort();
  const daysCount = dates.length || 1;
  const avgPerDay = total / daysCount;

  panel.html(`
    <h2>${app}</h2>
    <p><strong>Total:</strong> ${formatMinutes(total)}</p>
    <p><strong>Avg per day (selected range):</strong> ${formatMinutes(avgPerDay)}</p>
    <h3>Time by day</h3>
    <div id="miniChart"></div>
  `);

  const dayTotals = d3.rollups(
    rows,
    v => d3.sum(v, d => d.minutes),
    d => d.dateISO
  )
    .map(([dateISO, minutes]) => ({ dateISO, minutes }))
    .sort((a, b) => d3.ascending(a.dateISO, b.dateISO));

  // ---- Mini chart ----
  const miniContainer = d3.select("#miniChart");

  const margin = { top: 26, right: 10, bottom: 30, left: 44 }; // ✅ more top space
  const width = Math.min(420, miniContainer.node().clientWidth) - margin.left - margin.right;
  const height = 220 - margin.top - margin.bottom;

  const svg = miniContainer.append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand()
    .domain(dayTotals.map(d => d.dateISO))
    .range([0, width])
    .padding(0.25);

  const y = d3.scaleLinear()
    .domain([0, d3.max(dayTotals, d => d.minutes) || 1])
    .nice()
    .range([height, 0]);

  g.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x).tickFormat(d => {
        const date = new Date(d + "T00:00:00");
        return date.toLocaleDateString("en-US", { weekday: "short" });
    }))
    .selectAll("text")
    .attr("transform", "rotate(-35)")
    .style("text-anchor", "end");

  g.append("g")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d => `${Math.round(d)}m`));

  g.selectAll("rect")
    .data(dayTotals)
    .join("rect")
    .attr("x", d => x(d.dateISO))
    .attr("y", d => y(d.minutes))
    .attr("width", x.bandwidth())
    .attr("height", d => height - y(d.minutes))
    .attr("rx", 4)
    .attr("fill", appFill)
    .attr("stroke", "rgba(0,0,0,0.08)");

  // ---- Title (now safely inside top margin) ----
  g.append("text")
    .attr("x", 0)
    .attr("y", -10)
    .attr("font-size", 11)
    .attr("fill", "#444")
    .text(`Selected range: ${state.startDate} → ${state.endDate}`);
}
