(function(window, document, $) {
  "use strict";

  var config = window.appdataCleanupPlusConfig || {};
  var strings = config.strings || {};
  var modalThemeTokens = [
    "--acp-panel",
    "--acp-panel-soft",
    "--acp-border",
    "--acp-shadow",
    "--acp-heading",
    "--acp-text",
    "--acp-muted",
    "--acp-input-bg",
    "--acp-input-border",
    "--acp-input-text",
    "--acp-input-focus",
    "--acp-review-soft",
    "--acp-review-text",
    "--acp-filter-bg",
    "--acp-accent-soft",
    "--acp-accent-text",
    "--acp-safe-soft",
    "--acp-safe-text",
    "--acp-path-bg",
    "--acp-path-border",
    "--acp-path-text",
    "--acp-button-bg",
    "--acp-button-border",
    "--acp-button-text",
    "--acp-button-hover-bg",
    "--acp-button-hover-border",
    "--acp-button-hover-text",
    "--acp-button-primary-bg",
    "--acp-button-primary-border",
    "--acp-button-primary-text"
  ];
  var state = {
    rows: [],
    notices: [],
    summary: { total: 0, deletable: 0, review: 0, blocked: 0, ignored: 0 },
    selected: {},
    scanToken: "",
    settings: {
      allowOutsideShareCleanup: false,
      enablePermanentDelete: false,
      quarantineRoot: ""
    },
    riskFilter: "all",
    sortMode: "risk",
    showIgnored: false,
    busy: false
  };
  var els = {};

  $(init);

  function init() {
    cacheElements();
    applyThemeState();
    watchThemeChanges();
    bindEvents();
    renderSummaryCards();
    renderLoadingState();
    updateActionBar();
    loadScan();
  }

  function cacheElements() {
    els.$app = $("#acp-app");
    els.$summaryCards = $("#acp-summary-cards");
    els.$search = $("#acp-search");
    els.$riskFilter = $("#acp-risk-filter");
    els.$showIgnored = $("#acp-show-ignored");
    els.$allowExternal = $("#acp-allow-external");
    els.$enableDelete = $("#acp-enable-delete");
    els.$sort = $("#acp-sort");
    els.$rescan = $("#acp-rescan");
    els.$selectVisible = $("#acp-select-visible");
    els.$clearSelection = $("#acp-clear-selection");
    els.$doneBottom = $("#acp-done-bottom");
    els.$dryRun = $("#acp-dry-run");
    els.$primaryAction = $("#acp-primary-action");
    els.$resultsMeta = $("#acp-results-meta");
    els.$notices = $("#acp-notices");
    els.$results = $("#acp-results");
    els.$selectionSummary = $("#acp-selection-summary");
    els.$selectionDetail = $("#acp-selection-detail");
  }

  function bindEvents() {
    els.$search.on("input", renderAll);

    els.$riskFilter.on("change", function() {
      state.riskFilter = els.$riskFilter.val();
      renderResults();
      renderResultsMeta();
      updateActionBar();
    });

    els.$showIgnored.on("change", function() {
      state.showIgnored = !!els.$showIgnored.prop("checked");
      renderResults();
      renderResultsMeta();
      updateActionBar();
    });

    els.$sort.on("change", function() {
      state.sortMode = els.$sort.val();
      renderResults();
      renderResultsMeta();
    });

    els.$rescan.on("click", function() {
      if (!state.busy) {
        loadScan();
      }
    });

    els.$selectVisible.on("click", function() {
      if (!state.busy) {
        selectVisibleRows();
      }
    });

    els.$clearSelection.on("click", function() {
      if (state.busy) {
        return;
      }

      state.selected = {};
      renderResults();
      renderSummaryCards();
      updateActionBar();
    });

    els.$doneBottom.on("click", closePage);
    els.$dryRun.on("click", startDryRunFlow);
    els.$primaryAction.on("click", startPrimaryActionFlow);

    els.$allowExternal.on("change", saveSafetySettings);
    els.$enableDelete.on("change", saveSafetySettings);

    els.$results.on("click", ".acp-row", function(event) {
      if ($(event.target).closest(".acp-row-checkbox, .acp-button, a, button, input, select, textarea").length) {
        return;
      }

      var $checkbox = $(this).find(".acp-row-checkbox:not(:disabled)").first();
      if (!$checkbox.length) {
        return;
      }

      $checkbox.prop("checked", !$checkbox.prop("checked")).trigger("change");
    });

    els.$results.on("change", ".acp-row-checkbox", function() {
      var rowId = $(this).data("row-id");

      if (!rowId) {
        return;
      }

      if (this.checked) {
        state.selected[rowId] = true;
      } else {
        delete state.selected[rowId];
      }

      renderResults();
      renderSummaryCards();
      updateActionBar();
    });

    els.$results.on("click", ".acp-row-action", function(event) {
      var action = $(this).data("row-action");
      var rowId = $(this).data("row-id");

      event.preventDefault();
      event.stopPropagation();

      if (!action || !rowId || state.busy) {
        return;
      }

      postRowAction(action, rowId);
    });

    els.$results.on("click", "[data-action]", function() {
      var action = $(this).data("action");

      if (action === "clear-filters") {
        clearFilters();
      }

      if (action === "rescan") {
        loadScan();
      }
    });
  }

  function closePage() {
    if (typeof window.done === "function") {
      window.done();
    }
  }

  function normalizeHostThemeName(value) {
    var normalized = String(value || "").trim().toLowerCase();

    if (normalized === "grey") {
      return "gray";
    }

    return normalized;
  }

  function clampThemeChannel(value) {
    var numeric = Number(value);

    if (isNaN(numeric)) {
      numeric = 0;
    }

    return Math.max(0, Math.min(255, numeric));
  }

  function clampThemeAlpha(value) {
    var numeric = Number(value);

    if (isNaN(numeric)) {
      numeric = 1;
    }

    return Math.max(0, Math.min(1, numeric));
  }

  function parseThemeColor(value) {
    var trimmed = String(value || "").trim();
    var rgbMatch;
    var hex = "";

    if (!trimmed || trimmed === "transparent") {
      return null;
    }

    if (trimmed.charAt(0) === "#") {
      hex = trimmed.slice(1);

      if (hex.length === 3) {
        return {
          r: clampThemeChannel(parseInt(hex.charAt(0) + hex.charAt(0), 16)),
          g: clampThemeChannel(parseInt(hex.charAt(1) + hex.charAt(1), 16)),
          b: clampThemeChannel(parseInt(hex.charAt(2) + hex.charAt(2), 16)),
          a: 1
        };
      }

      if (hex.length === 6) {
        return {
          r: clampThemeChannel(parseInt(hex.slice(0, 2), 16)),
          g: clampThemeChannel(parseInt(hex.slice(2, 4), 16)),
          b: clampThemeChannel(parseInt(hex.slice(4, 6), 16)),
          a: 1
        };
      }
    }

    rgbMatch = trimmed.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i);
    if (!rgbMatch) {
      return null;
    }

    return {
      r: clampThemeChannel(rgbMatch[1]),
      g: clampThemeChannel(rgbMatch[2]),
      b: clampThemeChannel(rgbMatch[3]),
      a: clampThemeAlpha(rgbMatch[4] !== undefined ? rgbMatch[4] : 1)
    };
  }

  function resolveThemeSurfaceColor() {
    var i;
    var color;

    for (i = 0; i < arguments.length; i += 1) {
      color = arguments[i];
      if (color && clampThemeAlpha(color.a !== undefined ? color.a : 1) >= 0.08) {
        return color;
      }
    }

    for (i = 0; i < arguments.length; i += 1) {
      if (arguments[i]) {
        return arguments[i];
      }
    }

    return null;
  }

  function themeColorLuminance(color) {
    var channels;

    if (!color) {
      return 0;
    }

    channels = [color.r, color.g, color.b];
    return (0.2126 * normalizeChannel(channels[0])) + (0.7152 * normalizeChannel(channels[1])) + (0.0722 * normalizeChannel(channels[2]));

    function normalizeChannel(channel) {
      var value = clampThemeChannel(channel) / 255;
      return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    }
  }

  function inferThemeClass(themeName) {
    var normalized = normalizeHostThemeName(themeName);
    var bodyStyle = document.body ? window.getComputedStyle(document.body) : null;
    var htmlStyle = document.documentElement ? window.getComputedStyle(document.documentElement) : null;
    var background = resolveThemeSurfaceColor(
      parseThemeColor(bodyStyle ? bodyStyle.backgroundColor : ""),
      parseThemeColor(htmlStyle ? htmlStyle.backgroundColor : ""),
      parseThemeColor("#0f1825")
    );
    var luminance = themeColorLuminance(background);

    if (normalized.indexOf("white") !== -1 || normalized.indexOf("light") !== -1) {
      return "light";
    }

    if (normalized.indexOf("black") !== -1) {
      return "dark";
    }

    if (luminance >= 0.58) {
      return "light";
    }

    if (luminance <= 0.45) {
      return "dark";
    }

    return "mixed";
  }

  function resolveHostThemeName() {
    return normalizeHostThemeName(
      (document.documentElement && document.documentElement.getAttribute("data-acp-host-theme"))
      || (document.body && document.body.getAttribute("data-acp-host-theme"))
      || window.AppdataCleanupPlusHostThemeName
      || ""
    );
  }

  function applyThemeState() {
    var themeName = resolveHostThemeName();
    var themeClass = inferThemeClass(themeName);
    var appNode = els.$app && els.$app.length ? els.$app[0] : null;

    if (!appNode) {
      return;
    }

    if (themeName) {
      els.$app.attr("data-acp-host-theme", themeName);
    } else {
      els.$app.removeAttr("data-acp-host-theme");
    }

    if (themeClass) {
      els.$app.attr("data-acp-theme-class", themeClass);
    } else {
      els.$app.removeAttr("data-acp-theme-class");
    }

    appNode.style.colorScheme = themeClass === "light" ? "light" : "dark";
  }

  function watchThemeChanges() {
    var observer;
    var options = {
      attributes: true,
      attributeFilter: ["class", "style", "data-acp-host-theme", "data-theme", "theme", "data-color-scheme", "data-bs-theme"]
    };

    if (typeof window.MutationObserver !== "function") {
      return;
    }

    observer = new window.MutationObserver(function() {
      applyThemeState();
    });

    if (document.body) {
      observer.observe(document.body, options);
    }

    if (document.documentElement) {
      observer.observe(document.documentElement, options);
    }
  }

  function t(key, fallback) {
    if (strings[key]) {
      return strings[key];
    }
    return fallback;
  }

  function defaultSafetySettings() {
    return {
      allowOutsideShareCleanup: false,
      enablePermanentDelete: false,
      quarantineRoot: ""
    };
  }

  function buildApiRequestData(data) {
    return $.extend({
      csrfToken: String(config.csrfToken || "")
    }, data || {});
  }

  function apiPost(data) {
    var requestHeaders = {};

    if (config.csrfToken) {
      requestHeaders["X-Appdata-Cleanup-Plus-CSRF"] = String(config.csrfToken);
    }

    return $.ajax({
      url: config.apiUrl,
      method: "POST",
      dataType: "json",
      headers: requestHeaders,
      data: buildApiRequestData(data)
    });
  }

  function syncSafetyControls() {
    var settings = $.extend({}, defaultSafetySettings(), state.settings || {});

    els.$allowExternal.prop("checked", !!settings.allowOutsideShareCleanup);
    els.$enableDelete.prop("checked", !!settings.enablePermanentDelete);
  }

  function getPrimaryOperation() {
    return state.settings.enablePermanentDelete ? "delete" : "quarantine";
  }

  function getPrimaryActionLabel() {
    return state.settings.enablePermanentDelete
      ? t("deleteActionLabel", "Delete selected")
      : t("quarantineActionLabel", "Quarantine selected");
  }

  function setBusy(isBusy) {
    state.busy = !!isBusy;
    els.$app.toggleClass("is-busy", state.busy);
    els.$rescan.prop("disabled", state.busy);
    els.$search.prop("disabled", state.busy);
    els.$riskFilter.prop("disabled", state.busy);
    els.$showIgnored.prop("disabled", state.busy);
    els.$allowExternal.prop("disabled", state.busy);
    els.$enableDelete.prop("disabled", state.busy);
    els.$sort.prop("disabled", state.busy);
    updateActionBar();
  }

  function loadScan() {
    setBusy(true);
    renderLoadingState();

    apiPost({
      action: "getOrphanAppdata"
    }).done(function(response) {
      state.rows = $.isArray(response.rows) ? response.rows : [];
      state.notices = $.isArray(response.notices) ? response.notices : [];
      state.summary = response.summary || { total: 0, deletable: 0, review: 0, blocked: 0, ignored: 0 };
      state.scanToken = String(response.scanToken || "");
      state.settings = $.extend({}, defaultSafetySettings(), response.settings || {});
      syncSafetyControls();
      reconcileSelection();
      renderAll();
    }).fail(function(xhr) {
      state.rows = [];
      state.notices = [];
      state.summary = { total: 0, deletable: 0, review: 0, blocked: 0, ignored: 0 };
      state.scanToken = "";
      state.settings = defaultSafetySettings();
      state.selected = {};
      syncSafetyControls();
      renderSummaryCards();
      renderNotices([]);
      renderResultsMeta();
      renderStateMessage(
        t("scanFailedTitle", "Scan failed"),
        extractErrorMessage(xhr, t("scanFailedMessage", "The orphaned appdata scan could not be completed right now.")),
        "rescan",
        t("rescanLabel", "Rescan")
      );
      updateActionBar();
    }).always(function() {
      setBusy(false);
    });
  }

  function reconcileSelection() {
    var allowed = {};

    $.each(state.rows, function(_, row) {
      if (row.canDelete) {
        allowed[row.id] = true;
      }
    });

    $.each(Object.keys(state.selected), function(_, rowId) {
      if (!allowed[rowId]) {
        delete state.selected[rowId];
      }
    });
  }

  function renderAll() {
    renderSummaryCards();
    renderNotices(state.notices);
    renderResults();
    renderResultsMeta();
    updateActionBar();
  }

  function renderSummaryCards() {
    var selectedCount = getSelectedRows().length;
    var cards = [
      { label: t("cardTotal", "Detected"), value: state.summary.total || 0, tone: "" },
      { label: t("cardDeletable", "Ready to delete"), value: state.summary.deletable || 0, tone: "is-accent" },
      { label: t("cardReview", "Needs review"), value: state.summary.review || 0, tone: "is-review" },
      { label: t("cardBlocked", "Locked"), value: state.summary.blocked || 0, tone: "is-blocked" },
      { label: t("cardSelected", "Selected"), value: selectedCount, tone: "is-safe" }
    ];
    var html = [];

    $.each(cards, function(_, card) {
      html.push(
        '<article class="acp-summary-card ' + card.tone + '">' +
          '<span class="acp-summary-label">' + escapeHtml(card.label) + "</span>" +
          '<span class="acp-summary-value">' + escapeHtml(String(card.value)) + "</span>" +
        "</article>"
      );
    });

    els.$summaryCards.html(html.join(""));
  }

  function renderNotices(notices) {
    var html = [];

    $.each(notices || [], function(_, notice) {
      html.push(
        '<article class="acp-notice is-' + escapeHtml(notice.type || "info") + '">' +
          '<div class="acp-notice-title">' + escapeHtml(notice.title || "") + "</div>" +
          '<div class="acp-notice-message">' + escapeHtml(notice.message || "") + "</div>" +
        "</article>"
      );
    });

    els.$notices.html(html.join(""));
  }

  function renderLoadingState() {
    renderNotices([]);
    renderResultsMeta("");
    renderStateMessage(
      t("loadingTitle", "Scanning saved Docker templates"),
      t("loadingMessage", "Reviewing orphaned appdata folders and active container mappings."),
      null,
      null,
      true
    );
  }

  function buildRowMetaHtml(row) {
    var facts = [];
    var sourceText = row.sourceCount > 0 ? row.sourceSummary : row.name;

    facts.push('<span class="acp-row-meta-item"><strong>' + escapeHtml(t("templateLabel", "Template")) + "</strong> " + escapeHtml(sourceText || "") + "</span>");

    if (row.targetSummary) {
      facts.push('<span class="acp-row-meta-item"><strong>' + escapeHtml(t("targetLabel", "Target")) + "</strong> " + escapeHtml(row.targetSummary) + "</span>");
    }

    facts.push('<span class="acp-row-meta-item"><strong>' + escapeHtml(t("sizeLabel", "Size")) + "</strong> " + escapeHtml(row.sizeLabel || "Unknown") + "</span>");
    facts.push(
      '<span class="acp-row-meta-item"' + (row.lastModifiedExact ? ' title="' + escapeHtml(row.lastModifiedExact) + '"' : "") + '><strong>' +
      escapeHtml(t("updatedLabel", "Updated")) +
      "</strong> " + escapeHtml(row.lastModifiedLabel || "Unknown") + "</span>"
    );

    return facts.join('<span class="acp-row-meta-separator">|</span>');
  }

  function buildRowNotesHtml(row) {
    var notes = [];

    if (row.reason) {
      notes.push('<div class="acp-row-note is-primary">' + escapeHtml(row.reason) + "</div>");
    }

    if (row.policyReason) {
      notes.push('<div class="acp-row-note is-warning">' + escapeHtml(row.policyReason) + "</div>");
    }

    if (row.ignored && row.ignoredReason) {
      notes.push('<div class="acp-row-note">' + escapeHtml(row.ignoredReason) + "</div>");
    } else if (!row.policyReason && row.risk !== "safe" && row.riskReason) {
      notes.push('<div class="acp-row-note">' + escapeHtml(row.riskReason) + "</div>");
    }

    return notes.join("");
  }

  function buildRowActionHtml(row) {
    if (row.ignored) {
      return '<button type="button" class="acp-button acp-button-secondary acp-row-action" data-row-action="unignore" data-row-id="' + escapeHtml(row.id || "") + '">' + escapeHtml(t("restoreActionLabel", "Restore")) + "</button>";
    }

    if (row.id) {
      return '<button type="button" class="acp-button acp-button-secondary acp-row-action" data-row-action="ignore" data-row-id="' + escapeHtml(row.id || "") + '">' + escapeHtml(t("ignoreActionLabel", "Ignore")) + "</button>";
    }

    return "";
  }

  function renderResults() {
    var visibleRows = getVisibleRows();
    var html = [];

    if (!state.rows.length) {
      renderStateMessage(
        t("emptyTitle", "No orphaned appdata found"),
        t("emptyMessage", "Nothing currently looks safe to clean up from the saved Docker templates."),
        "rescan",
        t("rescanLabel", "Rescan")
      );
      return;
    }

    if (!visibleRows.length) {
      if (!state.showIgnored && Number(state.summary.total || 0) === 0 && Number(state.summary.ignored || 0) > 0) {
        renderStateMessage(
          t("ignoredOnlyTitle", "Only ignored paths remain"),
          t("ignoredOnlyMessage", "Every detected candidate is hidden by your ignore list. Turn on Show ignored to review or restore hidden paths."),
          null,
          null
        );
        return;
      }

      renderStateMessage(
        t("noMatchesTitle", "No folders match the current filters"),
        t("noMatchesMessage", "Clear the search or risk filters to see the full scan again."),
        "clear-filters",
        t("clearFiltersLabel", "Clear filters")
      );
      return;
    }

    $.each(visibleRows, function(_, row) {
      var isSelected = !!state.selected[row.id];
      var riskClass = "acp-badge-risk-" + escapeHtml(row.risk || "safe");
      var rowClass = "acp-row";
      var rowActionHtml = buildRowActionHtml(row);

      if (isSelected) {
        rowClass += " is-selected";
      }
      if (row.ignored) {
        rowClass += " is-ignored";
      }
      if (!row.canDelete) {
        rowClass += " is-disabled";
      } else {
        rowClass += " is-clickable";
      }

      html.push(
        '<article class="' + rowClass + '" data-row-id="' + escapeHtml(row.id) + '">' +
          '<div class="acp-row-check">' +
            '<input type="checkbox" class="acp-row-checkbox" data-row-id="' + escapeHtml(row.id) + '"' + (isSelected ? " checked" : "") + (row.canDelete ? "" : " disabled") + ">" +
          "</div>" +
          '<div class="acp-row-main">' +
            '<div class="acp-row-primary">' +
              '<div class="acp-row-title-wrap">' +
                '<div class="acp-row-title-line">' +
                  '<h3 class="acp-row-title">' + escapeHtml(row.name || row.displayPath || "") + "</h3>" +
                  '<div class="acp-row-badges">' +
                    '<span class="acp-badge acp-badge-status">' + escapeHtml(row.statusLabel || "Orphaned") + "</span>" +
                    '<span class="acp-badge ' + riskClass + '">' + escapeHtml(row.riskLabel || "Safe") + "</span>" +
                  "</div>" +
                "</div>" +
                '<div class="acp-row-meta">' + buildRowMetaHtml(row) + "</div>" +
                '<div class="acp-row-notes">' + buildRowNotesHtml(row) + "</div>" +
              "</div>" +
              '<div class="acp-row-side">' +
                '<code class="acp-row-path">' + escapeHtml(row.displayPath || row.path || "") + "</code>" +
                rowActionHtml +
              "</div>" +
            "</div>" +
          "</div>" +
        "</article>"
      );
    });

    els.$results.html(html.join(""));
  }

  function renderResultsMeta() {
    var visibleRows = getVisibleRows();
    var message = "";
    var ignoredCount = Number(state.summary.ignored || 0);

    if (state.rows.length || ignoredCount) {
      message = visibleRows.length + " " + t("visibleSummary", "visible") + " / " + Number(state.summary.total || 0) + " " + t("detectedSummary", "detected");
      if (ignoredCount > 0) {
        message += " | " + ignoredCount + " " + t(state.showIgnored ? "ignoredShownSummary" : "ignoredHiddenSummary", state.showIgnored ? "ignored shown" : "ignored hidden");
      }
    }

    els.$resultsMeta.text(message);
  }

  function renderStateMessage(title, message, action, actionLabel, isLoading) {
    var iconSrc = isLoading ? (config.spinnerUrl || "") : (config.logoUrl || config.spinnerUrl || "");
    var iconHtml = '<div class="acp-state-icon"><img src="' + escapeHtml(iconSrc) + '" alt=""></div>';
    var actionHtml = "";

    if (action && actionLabel) {
      actionHtml = '<div class="acp-state-actions"><button type="button" class="acp-button acp-button-secondary" data-action="' + escapeHtml(action) + '">' + escapeHtml(actionLabel) + "</button></div>";
    }

    els.$results.html(
      '<section class="acp-state">' +
        iconHtml +
        '<h3 class="acp-state-title">' + escapeHtml(title) + "</h3>" +
        '<p class="acp-state-message">' + escapeHtml(message) + "</p>" +
        actionHtml +
      "</section>"
    );
  }

  function getVisibleRows() {
    var riskFilter = state.riskFilter;
    var searchTerm = $.trim(String(els.$search.val() || "")).toLowerCase();
    var rows = state.rows.slice(0);

    rows = $.grep(rows, function(row) {
      var haystack = [
        row.name,
        row.displayPath,
        row.sourceSummary,
        row.targetSummary,
        row.reason,
        row.policyReason,
        row.securityLockReason,
        row.ignoredReason,
        row.sizeLabel,
        row.lastModifiedLabel,
        (row.sourceNames || []).join(" "),
        (row.targetPaths || []).join(" ")
      ].join(" ").toLowerCase();

      if (row.ignored && !state.showIgnored) {
        return false;
      }

      if (riskFilter !== "all" && row.risk !== riskFilter) {
        return false;
      }

      if (searchTerm && haystack.indexOf(searchTerm) === -1) {
        return false;
      }

      return true;
    });

    rows.sort(compareRows);
    return rows;
  }

  function compareRows(left, right) {
    var riskRank = { review: 0, safe: 1, blocked: 2 };
    var leftName = String(left.name || "").toLowerCase();
    var rightName = String(right.name || "").toLowerCase();
    var leftPath = String(left.displayPath || left.path || "").toLowerCase();
    var rightPath = String(right.displayPath || right.path || "").toLowerCase();
    var leftRank = Object.prototype.hasOwnProperty.call(riskRank, left.risk) ? riskRank[left.risk] : 9;
    var rightRank = Object.prototype.hasOwnProperty.call(riskRank, right.risk) ? riskRank[right.risk] : 9;

    if (!!left.ignored !== !!right.ignored) {
      return left.ignored ? 1 : -1;
    }

    if (state.sortMode === "name") {
      return leftName.localeCompare(rightName) || leftPath.localeCompare(rightPath);
    }

    if (state.sortMode === "path") {
      return leftPath.localeCompare(rightPath) || leftName.localeCompare(rightName);
    }

    return leftRank - rightRank || leftPath.localeCompare(rightPath);
  }

  function selectVisibleRows() {
    $.each(getVisibleRows(), function(_, row) {
      if (row.canDelete) {
        state.selected[row.id] = true;
      }
    });

    renderResults();
    renderSummaryCards();
    updateActionBar();
  }

  function updateActionBar() {
    var selectedRows = getSelectedRows();
    var visibleSelectableCount = $.grep(getVisibleRows(), function(row) {
      return !!row.canDelete;
    }).length;
    var reviewSelected = $.grep(selectedRows, function(row) {
      return row.risk === "review";
    }).length;
    var summaryText = selectedRows.length + " " + (selectedRows.length === 1 ? t("selectedSingular", "folder selected") : t("selectedPlural", "folders selected"));
    var detailText = t("selectionHintIdle", "Click rows to select. Locked paths stay visible but cannot be selected.");

    if (!state.settings.allowOutsideShareCleanup && Number(state.summary.review || 0) > 0) {
      detailText = t("selectionHintSafety", "Outside-share cleanup is disabled, so review rows stay locked until you enable it.");
    } else if (reviewSelected > 0 && state.settings.enablePermanentDelete) {
      detailText = t("selectionHintReview", "Review rows need typed confirmation before delete.");
    } else if (selectedRows.length && state.settings.enablePermanentDelete) {
      detailText = t("selectionHintDeleteMode", "Permanent delete mode is enabled.");
    } else if (selectedRows.length) {
      detailText = t("selectionHintQuarantineMode", "Selected folders will be moved into quarantine instead of being permanently deleted.");
    }

    els.$selectionSummary.text(summaryText);
    els.$selectionDetail.text(detailText);
    els.$primaryAction.text(getPrimaryActionLabel());
    els.$primaryAction.prop("disabled", state.busy || !state.scanToken || selectedRows.length === 0);
    els.$dryRun.prop("disabled", state.busy || !state.scanToken || selectedRows.length === 0);
    els.$selectVisible.prop("disabled", state.busy || visibleSelectableCount === 0);
    els.$clearSelection.prop("disabled", state.busy || selectedRows.length === 0);
    els.$doneBottom.prop("disabled", state.busy);
  }

  function getSelectedRows() {
    return $.grep(state.rows, function(row) {
      return !!state.selected[row.id] && row.canDelete;
    });
  }

  function clearFilters() {
    state.riskFilter = "all";
    state.showIgnored = false;
    els.$search.val("");
    els.$riskFilter.val("all");
    els.$showIgnored.prop("checked", false);
    renderResults();
    renderResultsMeta();
    updateActionBar();
  }

  function saveSafetySettings() {
    var previousSettings = $.extend({}, defaultSafetySettings(), state.settings || {});
    var nextSettings = $.extend({}, previousSettings, {
      allowOutsideShareCleanup: !!els.$allowExternal.prop("checked"),
      enablePermanentDelete: !!els.$enableDelete.prop("checked")
    });

    state.settings = nextSettings;
    syncSafetyControls();
    updateActionBar();

    if (!state.scanToken) {
      loadScan();
      return;
    }

    setBusy(true);

    apiPost({
      action: "saveSafetySettings",
      scanToken: state.scanToken,
      allowOutsideShareCleanup: nextSettings.allowOutsideShareCleanup ? "1" : "0",
      enablePermanentDelete: nextSettings.enablePermanentDelete ? "1" : "0"
    }).done(function(response) {
      state.settings = $.extend({}, defaultSafetySettings(), response.settings || nextSettings);
      syncSafetyControls();
      loadScan();
    }).fail(function(xhr) {
      state.settings = previousSettings;
      syncSafetyControls();
      setBusy(false);
      swal(t("settingsSaveFailedTitle", "Safety settings failed"), extractErrorMessage(xhr, t("settingsSaveFailedMessage", "The new safety settings could not be saved right now.")), "error");
      if (xhr && xhr.status === 409) {
        loadScan();
      } else {
        updateActionBar();
      }
    });
  }

  function postRowAction(action, rowId) {
    var intent = action === "unignore" ? "unignore" : "ignore";
    var failureTitle = action === "unignore" ? t("restoreFailedTitle", "Restore failed") : t("ignoreFailedTitle", "Ignore failed");
    var failureMessage = action === "unignore" ? t("restoreFailedMessage", "The ignore list could not be updated right now.") : t("ignoreFailedMessage", "The ignore list could not be updated right now.");

    setBusy(true);

    apiPost({
      action: "updateCandidateState",
      scanToken: state.scanToken,
      candidateIds: JSON.stringify([rowId]),
      intent: intent
    }).done(function() {
      loadScan();
    }).fail(function(xhr) {
      setBusy(false);
      swal(failureTitle, extractErrorMessage(xhr, failureMessage), "error");
      if (xhr && xhr.status === 409) {
        loadScan();
      }
    });
  }

  function buildOperationContext(operation) {
    var baseOperation = String(operation || "").replace(/^preview_/, "");
    var preview = baseOperation !== operation;
    var isDelete = baseOperation === "delete";

    return {
      operation: operation,
      preview: preview,
      baseOperation: baseOperation,
      confirmTitle: isDelete ? t("deleteConfirmTitle", "Delete selected folders?") : t("quarantineConfirmTitle", "Quarantine selected folders?"),
      confirmMessage: isDelete ? t("deleteConfirmMessage", "Selected folders will be removed immediately.") : t("quarantineConfirmMessage", "Selected folders will be moved into quarantine instead of being permanently deleted."),
      detailMessage: isDelete ? t("deleteIrreversibleMessage", "This action cannot be undone by this plugin.") : t("quarantineDetailMessage", "The selected folders will be moved into the quarantine root instead of being permanently deleted."),
      confirmButtonLabel: isDelete ? t("deleteConfirmButton", "Delete") : t("quarantineConfirmButton", "Quarantine"),
      loadingTitle: preview ? t("dryRunTitle", "Running dry run") : (isDelete ? t("deletingTitle", "Deleting selected folders") : t("quarantiningTitle", "Moving selected folders to quarantine")),
      loadingMessage: preview ? t("dryRunMessage", "Reviewing what the current action would do without changing anything.") : (isDelete ? t("deletingMessage", "Large folders can take a moment to remove.") : t("quarantiningMessage", "Selected folders are being moved into a hidden quarantine root.")),
      resultTitleSuccess: preview ? t("dryRunResultTitleSuccess", "Dry run complete") : (isDelete ? t("deleteResultTitleSuccess", "Cleanup complete") : t("quarantineResultTitleSuccess", "Quarantine complete")),
      resultTitleWarning: preview ? t("dryRunResultTitleWarning", "Dry run finished with warnings") : (isDelete ? t("deleteResultTitleWarning", "Cleanup finished with warnings") : t("quarantineResultTitleWarning", "Quarantine finished with warnings")),
      failureTitle: isDelete ? t("deleteFailedTitle", "Delete failed") : t("quarantineFailedTitle", "Quarantine failed"),
      listTitle: preview ? t("previewListTitle", "Operation preview") : (isDelete ? t("deleteListTitle", "Folders to delete") : t("quarantineListTitle", "Folders to quarantine")),
      successStatus: preview ? "ready" : (isDelete ? "deleted" : "quarantined"),
      warningLabel: preview ? t("previewWarningLabel", "DRY RUN") : t("deleteWarningLabel", "WARNING")
    };
  }

  function buildActionConfirmButtonText(context, count) {
    var noun = count === 1 ? t("deleteFolderSingular", "folder") : t("deleteFolderPlural", "folders");
    return context.confirmButtonLabel + " " + count + " " + noun;
  }

  function buildOperationPreviewHtml(rows, context, options) {
    var settings = options || {};
    var reviewCount = typeof settings.reviewCount === "number" ? settings.reviewCount : $.grep(rows, function(row) {
      return row.risk === "review";
    }).length;
    var safeCount = Math.max(0, rows.length - reviewCount);
    var preview = rows.slice(0, 6);
    var html = [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-flag">' + escapeHtml(t("deleteWarningLabel", "WARNING")) + "</div>",
      '<div class="acp-modal-copy">',
      '<div class="acp-modal-lead">' + escapeHtml(context.confirmMessage) + "</div>",
      '<div class="acp-modal-subcopy">' + escapeHtml(context.detailMessage) + "</div>",
      "</div>",
      '<div class="acp-modal-stats">',
      '<span class="acp-modal-stat is-selected">' + escapeHtml(String(rows.length)) + " selected</span>",
      '<span class="acp-modal-stat is-safe">' + escapeHtml(t("deleteSafeLabel", "Safe")) + ": " + escapeHtml(String(safeCount)) + "</span>"
    ];

    if (reviewCount > 0) {
      html.push('<span class="acp-modal-stat is-review">' + escapeHtml(t("deleteReviewCountLabel", "Review")) + ": " + escapeHtml(String(reviewCount)) + "</span>");
    }

    html.push("</div>");

    if (reviewCount > 0) {
      html.push(
        '<div class="acp-modal-warning-box">' +
          '<strong>' + escapeHtml(t("deleteReviewLabel", "Review required")) + ".</strong> " +
          escapeHtml(t("deleteTypedMessage", "One or more selected folders sit outside the configured appdata share.")) +
        "</div>"
      );
    }

    if (settings.showTypeHint) {
      html.push('<div class="acp-modal-hint">' + escapeHtml(t("deleteTypedHint", "Type DELETE to continue with this higher-risk cleanup.")) + "</div>");
    }

    html.push('<div class="acp-modal-panel">');
    html.push('<div class="acp-modal-panel-title">' + escapeHtml(context.listTitle) + "</div>");
    html.push('<ul class="acp-modal-list">');

    $.each(preview, function(_, row) {
      html.push('<li><code class="acp-modal-path">' + escapeHtml(row.displayPath || row.path || "") + "</code></li>");
    });

    if (rows.length > preview.length) {
      html.push('<li class="acp-modal-list-more">+' + escapeHtml(String(rows.length - preview.length)) + " more</li>");
    }

    html.push("</ul></div></div>");
    return html.join("");
  }

  function formatOperationResultStatus(status) {
    switch (status) {
      case "ready":
        return { label: t("previewReadyLabel", "Ready"), tone: "is-selected" };
      case "quarantined":
        return { label: t("resultQuarantinedLabel", "Quarantined"), tone: "is-safe" };
      case "deleted":
        return { label: t("resultDeletedLabel", "Deleted"), tone: "is-selected" };
      case "missing":
        return { label: t("resultMissingLabel", "Missing"), tone: "is-blocked" };
      case "blocked":
        return { label: t("resultBlockedLabel", "Blocked"), tone: "is-review" };
      default:
        return { label: t("resultErrorLabel", "Error"), tone: "is-review" };
    }
  }

  function buildOperationResultsHtml(summary, results, context) {
    var stats = [];
    var html = ['<div class="acp-modal-summary">'];

    if (context.preview) {
      html.push('<div class="acp-modal-flag is-preview">' + escapeHtml(context.warningLabel) + "</div>");
      stats.push('<span class="acp-modal-stat is-selected">' + escapeHtml(t("previewReadyLabel", "Ready")) + ": " + escapeHtml(String(summary.ready || 0)) + "</span>");
    } else if (context.baseOperation === "delete") {
      stats.push('<span class="acp-modal-stat is-selected">' + escapeHtml(t("resultDeletedLabel", "Deleted")) + ": " + escapeHtml(String(summary.deleted || 0)) + "</span>");
    } else {
      stats.push('<span class="acp-modal-stat is-safe">' + escapeHtml(t("resultQuarantinedLabel", "Quarantined")) + ": " + escapeHtml(String(summary.quarantined || 0)) + "</span>");
    }

    stats.push('<span class="acp-modal-stat is-review">' + escapeHtml(t("resultBlockedLabel", "Blocked")) + ": " + escapeHtml(String(summary.blocked || 0)) + "</span>");
    stats.push('<span class="acp-modal-stat">' + escapeHtml(t("resultMissingLabel", "Missing")) + ": " + escapeHtml(String(summary.missing || 0)) + "</span>");
    stats.push('<span class="acp-modal-stat">' + escapeHtml(t("resultErrorLabel", "Error")) + ": " + escapeHtml(String(summary.errors || 0)) + "</span>");

    html.push('<div class="acp-modal-stats">' + stats.join("") + "</div>");
    html.push('<div class="acp-modal-panel">');
    html.push('<div class="acp-modal-panel-title">' + escapeHtml(context.listTitle) + "</div>");
    html.push('<ul class="acp-modal-list acp-modal-result-list">');

    $.each(results || [], function(_, result) {
      var statusMeta = formatOperationResultStatus(result.status);
      var destinationHtml = "";
      var messageHtml = result.message ? '<div class="acp-modal-result-message">' + escapeHtml(result.message) + "</div>" : "";

      if (result.destination) {
        destinationHtml =
          '<div class="acp-modal-result-destination">' +
            '<span class="acp-modal-result-label">' + escapeHtml(t("destinationLabel", "Destination")) + "</span>" +
            '<code class="acp-modal-path acp-modal-path-secondary">' + escapeHtml(result.destination) + "</code>" +
          "</div>";
      }

      html.push(
        '<li class="acp-modal-result">' +
          '<div class="acp-modal-result-head">' +
            '<span class="acp-modal-stat ' + statusMeta.tone + '">' + escapeHtml(statusMeta.label) + "</span>" +
            '<code class="acp-modal-path">' + escapeHtml(result.displayPath || result.path || "") + "</code>" +
          "</div>" +
          messageHtml +
          destinationHtml +
        "</li>"
      );
    });

    html.push("</ul></div></div>");
    return html.join("");
  }

  function startDryRunFlow() {
    var selectedRows = getSelectedRows();

    if (!selectedRows.length) {
      swal(t("deleteEmptyTitle", "Nothing selected"), t("deleteEmptyMessage", "Select at least one deletable folder before continuing."), "warning");
      return;
    }

    runCandidateOperation(selectedRows, "preview_" + getPrimaryOperation());
  }

  function startPrimaryActionFlow() {
    var selectedRows = getSelectedRows();
    var reviewRows = $.grep(selectedRows, function(row) {
      return row.risk === "review";
    });
    var context = buildOperationContext(getPrimaryOperation());
    var confirmButtonText = buildActionConfirmButtonText(context, selectedRows.length);

    if (!selectedRows.length) {
      swal(t("deleteEmptyTitle", "Nothing selected"), t("deleteEmptyMessage", "Select at least one deletable folder before continuing."), "warning");
      return;
    }

    if (context.baseOperation === "delete" && reviewRows.length) {
      swal({
        title: context.confirmTitle,
        text: "",
        type: "input",
        html: true,
        showCancelButton: true,
        closeOnConfirm: false,
        inputPlaceholder: t("deleteTypedPlaceholder", "DELETE"),
        confirmButtonText: confirmButtonText
      }, function(inputValue) {
        if (inputValue === false) {
          return false;
        }

        if ($.trim(String(inputValue || "")).toUpperCase() !== "DELETE") {
          swal.showInputError(t("deleteTypedError", "Type DELETE to continue."));
          return false;
        }

        runCandidateOperation(selectedRows, context.operation);
        return true;
      });
      applyDeleteModalClass("acp-delete-modal acp-delete-modal-review", buildOperationPreviewHtml(selectedRows, context, {
        reviewCount: reviewRows.length,
        showTypeHint: true
      }));
      return;
    }

    swal({
      title: context.confirmTitle,
      text: "",
      type: "warning",
      html: true,
      showCancelButton: true,
      closeOnConfirm: false,
      confirmButtonText: confirmButtonText
    }, function() {
      runCandidateOperation(selectedRows, context.operation);
    });
    applyDeleteModalClass("acp-delete-modal", buildOperationPreviewHtml(selectedRows, context, {
      reviewCount: 0,
      showTypeHint: false
    }));
  }

  function runCandidateOperation(selectedRows, operation) {
    var context = buildOperationContext(operation);

    setBusy(true);
    applyDeleteModalClass("");
    swal({
      title: context.loadingTitle,
      text: context.loadingMessage,
      type: "info",
      showConfirmButton: false,
      allowEscapeKey: false,
      allowOutsideClick: false
    });

    apiPost({
      action: "executeCandidateAction",
      scanToken: state.scanToken,
      candidateIds: JSON.stringify($.map(selectedRows, function(row) {
        return row.id;
      })),
      operation: operation
    }).done(function(response) {
      var summary = response.summary || { ready: 0, quarantined: 0, deleted: 0, missing: 0, blocked: 0, errors: 0 };
      var results = $.isArray(response.results) ? response.results : [];
      var hasWarnings = Number(summary.blocked || 0) > 0 || Number(summary.missing || 0) > 0 || Number(summary.errors || 0) > 0;
      var modalTitle = hasWarnings ? context.resultTitleWarning : context.resultTitleSuccess;
      var modalType = hasWarnings ? "warning" : "success";

      setBusy(false);

      if (!context.preview) {
        state.selected = {};
      }

      swal({
        title: modalTitle,
        text: "",
        type: modalType,
        html: true
      }, function() {
        if (!context.preview) {
          loadScan();
        }
      });
      applyDeleteModalClass("acp-delete-modal acp-delete-results-modal", buildOperationResultsHtml(summary, results, context));
      renderSummaryCards();
      updateActionBar();
    }).fail(function(xhr) {
      var fallbackMessage = extractErrorMessage(xhr, t("scanFailedMessage", "The orphaned appdata scan could not be completed right now."));

      setBusy(false);

      if (xhr && xhr.status === 409) {
        swal({
          title: context.failureTitle,
          text: fallbackMessage,
          type: "error"
        }, function() {
          loadScan();
        });
        return;
      }

      swal(context.failureTitle, fallbackMessage, "error");
    });
  }

  function applyDeleteModalClass(className, htmlContent) {
    window.setTimeout(function() {
      var $modal = $(".sweet-alert:visible").first();
      var $message = $modal.find("p").first();

      if (!$modal.length) {
        return;
      }

      $modal.removeClass("acp-delete-modal acp-delete-modal-review acp-delete-results-modal");
      if (className) {
        $modal.addClass(className);
      }

      syncDeleteModalThemeTokens($modal);

      if ($message.length) {
        $message.removeClass("acp-modal-host");
        if (typeof htmlContent === "string") {
          $message.html(htmlContent).addClass("acp-modal-host");
        } else {
          $message.empty();
        }
      }
    }, 0);
  }

  function syncDeleteModalThemeTokens($modal) {
    var modalNode = $modal && $modal.length ? $modal[0] : null;
    var sourceNode = els.$app && els.$app.length ? els.$app[0] : null;
    var overlayNode = $(".sweet-overlay:visible").first()[0];
    var computedStyle;

    if (!modalNode || !sourceNode || typeof window.getComputedStyle !== "function") {
      return;
    }

    computedStyle = window.getComputedStyle(sourceNode);
    $.each(modalThemeTokens, function(_, tokenName) {
      var tokenValue = String(computedStyle.getPropertyValue(tokenName) || "").trim();
      if (!tokenValue) {
        return;
      }
      modalNode.style.setProperty(tokenName, tokenValue);
      if (overlayNode) {
        overlayNode.style.setProperty(tokenName, tokenValue);
      }
    });

    modalNode.style.colorScheme = sourceNode.style.colorScheme || "dark";
    if (overlayNode) {
      overlayNode.style.backgroundColor = "rgba(5, 8, 12, 0.76)";
    }
  }

  function extractErrorMessage(xhr, fallback) {
    if (xhr && xhr.responseJSON && xhr.responseJSON.message) {
      return xhr.responseJSON.message;
    }

    if (xhr && xhr.responseText) {
      try {
        var parsed = JSON.parse(xhr.responseText);
        if (parsed && parsed.message) {
          return parsed.message;
        }
      } catch (error) {
      }
    }

    return fallback;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})(window, document, jQuery);
