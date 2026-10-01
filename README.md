# PBI Dependency Visualizer

When refactoring Power BI dashboards, tracing and analyzing the dependencies of a measure is a critical step.

For analyzing these dependencies (along with a ton of other great features), there is no doubt that **Measure Killer** is the best tool. However, when your dashboards are connected to SSAS via a **Live Connection**, the free version of Measure Killer no longer supports this functionality.

To work around this limitation, I typically analyze dependencies between model components using **Tabular Editor 2**, which does an excellent job:

<img width="1333" height="835" alt="Pasted image 20261001185151" src="https://github.com/user-attachments/assets/39f2dd01-d0ac-4b0f-91dc-299c6b5ce401" />


Additionally, we can extract the model's dependency metadata using a DMV called `DISCOVER_CALC_DEPENDENCY` and visualize the results. It looks something like this:

<img width="1426" height="834" alt="Pasted image 20261001173810" src="https://github.com/user-attachments/assets/a736e298-2af9-48ed-97d5-4cad946009b0" />

[Chris Webb's BI Blog: Documenting dependencies between DAX calculations](https://blog.crossjoin.co.uk/2011/09/17/documenting-dependencies-between-dax-calculations/)

[DAX Measure Dependencies in SSAS Tabular and Power BI - biinsight.com](https://biinsight.com/dax-measure-dependencies-in-ssas-tabular-and-power-bi/)

By leveraging Power BI's built-in interactive features, we can cross-filter and thoroughly investigate the dependencies of any specific measure at the model level.

---

### The Challenge: Report-Level Usage

While the model-level dependencies are covered, another major need arises: **What about the reports?** How can we find out exactly which pages or which specific visuals are using a particular measure?

One workaround is to extract the `.pbix` file using [pbi-tools](https://pbi.tools/), open the extracted folder in VS Code, and use the global search (`Ctrl + Shift + F`) to find the measure across the entire project. For example:

<img width="1920" height="1028" alt="Pasted image 20261001145503" src="https://github.com/user-attachments/assets/0a0a65c4-31f9-4ded-a72d-afb8abc23415" />

However, the challenge with this approach is readability; it is quite difficult to grasp the exact details and context of the usage just by looking at raw JSON and source files.

---

### The Solution

To solve this problem, I wrote this simple tool. You can point it to a root directory containing multiple folders of extracted `.pbix` files, search for a specific measure, and instantly see exactly where and how it is being used across your reports in a clean, understandable format:

<img width="1399" height="860" alt="Pasted image 20261001175035" src="https://github.com/user-attachments/assets/2f4b5c7c-a67c-4617-a0be-aedcfc7a9a28" />

---

### How to Use

No installation, backend server, or dependencies are required—this is a lightweight, fully client-side web application.

1. **Clone or download** this repository to your local machine.
2. Open the `power_bi_dependency_visualizer.html` file directly in Chrome web browser.
3. Select the root folder containing your extracted `.pbix` directory (extracted via `pbi-tools`).
4. Type in the measure name to search and instantly view its report-level usage across all visuals and pages.
