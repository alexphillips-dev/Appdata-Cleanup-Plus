(function(window, document, $) {
  "use strict";

  var config = window.appdataCleanupPlusConfig || {};
  var strings = config.strings || {};
  var state = {
    rows: [],
    notices: [],
    summary: { total: 0, deletable: 0, review: 0, blocked: 0 },
    selected: {},
    riskFilter: "all",
    sortMode: "risk",
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
    els.$sort = $("#acp-sort");
    els.$rescan = $("#acp-rescan");
    els.$selectVisible = $("#acp-select-visible");
    els.$clearSelection = $("#acp-clear-selection");
    els.$doneBottom = $("#acp-done-bottom");
    els.$deleteSelected = $("#acp-delete-selected");
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
    els.$deleteSelected.on("click", startDeleteFlow);

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

  function setBusy(isBusy) {
    state.busy = !!isBusy;
    els.$app.toggleClass("is-busy", state.busy);
    els.$rescan.prop("disabled", state.busy);
    els.$search.prop("disabled", state.busy);
    els.$riskFilter.prop("disabled", state.busy);
    els.$sort.prop("disabled", state.busy);
    updateActionBar();
  }

  function loadScan() {
    setBusy(true);
    renderLoadingState();

    $.ajax({
      url: config.apiUrl,
      method: "POST",
      dataType: "json",
      data: { action: "getOrphanAppdata" }
    }).done(function(response) {
      state.rows = $.isArray(response.rows) ? response.rows : [];
      state.notices = $.isArray(response.notices) ? response.notices : [];
      state.summary = response.summary || { total: 0, deletable: 0, review: 0, blocked: 0 };
      reconcileSelection();
      renderAll();
    }).fail(function(xhr) {
      state.rows = [];
      state.notices = [];
      state.summary = { total: 0, deletable: 0, review: 0, blocked: 0 };
      state.selected = {};
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
      var sourceText = row.sourceCount > 0 ? row.sourceSummary : row.name;
      var metaItems = [];

      if (isSelected) {
        rowClass += " is-selected";
      }
      if (!row.canDelete) {
        rowClass += " is-disabled";
      } else {
        rowClass += " is-clickable";
      }

      metaItems.push('<span class="acp-row-meta-item"><strong>Template</strong> ' + escapeHtml(sourceText) + "</span>");
      metaItems.push('<span class="acp-row-meta-item">' + escapeHtml(row.reason || "") + "</span>");
      if (row.risk !== "safe") {
        metaItems.push('<span class="acp-row-meta-item">' + escapeHtml(row.riskReason || "") + "</span>");
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
                '<div class="acp-row-meta">' + metaItems.join('<span class="acp-row-meta-separator">|</span>') + "</div>" +
              "</div>" +
              '<code class="acp-row-path">' + escapeHtml(row.displayPath || row.path || "") + "</code>" +
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

    if (state.rows.length) {
      message = visibleRows.length + " " + t("visibleSummary", "visible") + " / " + state.rows.length + " " + t("detectedSummary", "detected");
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
        (row.sourceNames || []).join(" ")
      ].join(" ").toLowerCase();

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

    if (reviewSelected > 0) {
      detailText = t("selectionHintReview", "Review rows need typed confirmation before delete.");
    }

    els.$selectionSummary.text(summaryText);
    els.$selectionDetail.text(detailText);
    els.$deleteSelected.prop("disabled", state.busy || selectedRows.length === 0);
    els.$selectVisible.prop("disabled", state.busy || visibleSelectableCount === 0);
    els.$clearSelection.prop("disabled", state.busy || selectedRows.length === 0);
  }

  function getSelectedRows() {
    return $.grep(state.rows, function(row) {
      return !!state.selected[row.id] && row.canDelete;
    });
  }

  function clearFilters() {
    state.riskFilter = "all";
    els.$search.val("");
    els.$riskFilter.val("all");
    renderResults();
    renderResultsMeta();
    updateActionBar();
  }

  function startDeleteFlow() {
    var selectedRows = getSelectedRows();
    var reviewRows = $.grep(selectedRows, function(row) {
      return row.risk === "review";
    });
    var confirmButtonText = buildDeleteConfirmButtonText(selectedRows.length);

    if (!selectedRows.length) {
      swal(t("deleteEmptyTitle", "Nothing selected"), t("deleteEmptyMessage", "Select at least one deletable folder before continuing."), "warning");
      return;
    }

    if (reviewRows.length) {
      swal({
        title: t("deleteConfirmTitle", "Delete selected folders?"),
        text: buildDeletePreviewHtml(selectedRows, {
          reviewCount: reviewRows.length,
          showTypeHint: true
        }),
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

        runDelete(selectedRows);
        return true;
      });
      applyDeleteModalClass("acp-delete-modal acp-delete-modal-review");
      return;
    }

    swal({
      title: t("deleteConfirmTitle", "Delete selected folders?"),
      text: buildDeletePreviewHtml(selectedRows, {
        reviewCount: 0,
        showTypeHint: false
      }),
      type: "warning",
      html: true,
      showCancelButton: true,
      closeOnConfirm: false,
      confirmButtonText: confirmButtonText
    }, function() {
      runDelete(selectedRows);
    });
    applyDeleteModalClass("acp-delete-modal");
  }

  function runDelete(selectedRows) {
    applyDeleteModalClass("");
    swal({
      title: t("deletingTitle", "Deleting selected folders"),
      text: t("deletingMessage", "Large folders can take a moment to remove."),
      type: "info",
      showConfirmButton: false,
      allowEscapeKey: false,
      allowOutsideClick: false
    });

    $.ajax({
      url: config.apiUrl,
      method: "POST",
      dataType: "json",
      data: {
        action: "deleteAppdata",
        paths: JSON.stringify($.map(selectedRows, function(row) { return row.path; }))
      }
    }).done(function(response) {
      var summary = response.summary || { deleted: 0, missing: 0, blocked: 0, errors: 0 };
      var failures = $.grep(response.results || [], function(result) {
        return result.status !== "deleted";
      });
      var modalTitle = failures.length ? t("deleteResultTitleWarning", "Cleanup finished with warnings") : t("deleteResultTitleSuccess", "Cleanup complete");
      var modalType = failures.length ? "warning" : "success";

      state.selected = {};

      swal({
        title: modalTitle,
        text: buildDeleteResultsHtml(summary, failures),
        type: modalType,
        html: true
      }, function() {
        loadScan();
      });
    }).fail(function(xhr) {
      swal(t("deleteFailedTitle", "Delete failed"), extractErrorMessage(xhr, t("scanFailedMessage", "The orphaned appdata scan could not be completed right now.")), "error");
      loadScan();
    });
  }

  function buildDeleteConfirmButtonText(count) {
    var noun = count === 1 ? t("deleteFolderSingular", "folder") : t("deleteFolderPlural", "folders");
    return t("deleteConfirmButton", "Delete") + " " + count + " " + noun;
  }

  function buildDeletePreviewHtml(rows, options) {
    var settings = options || {};
    var reviewCount = typeof settings.reviewCount === "number" ? settings.reviewCount : $.grep(rows, function(row) {
      return row.risk === "review";
    }).length;
    var safeCount = Math.max(0, rows.length - reviewCount);
    var html = [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-flag">' + escapeHtml(t("deleteWarningLabel", "WARNING")) + "</div>",
      '<div class="acp-modal-copy">',
      '<div class="acp-modal-lead">' + escapeHtml(t("deleteConfirmMessage", "Selected folders will be removed immediately.")) + "</div>",
      '<div class="acp-modal-subcopy">' + escapeHtml(t("deleteIrreversibleMessage", "This action cannot be undone by this plugin.")) + "</div>",
      "</div>",
      '<div class="acp-modal-stats">',
      '<span class="acp-modal-stat is-selected">' + escapeHtml(String(rows.length)) + " selected</span>",
      '<span class="acp-modal-stat is-safe">' + escapeHtml(t("deleteSafeLabel", "Safe")) + ": " + escapeHtml(String(safeCount)) + "</span>"
    ];
    var preview = rows.slice(0, 6);

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
    html.push('<div class="acp-modal-panel-title">' + escapeHtml(t("deleteListTitle", "Folders to delete")) + "</div>");
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

  function buildDeleteResultsHtml(summary, failures) {
    var html = [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-stats">',
      '<span class="acp-modal-stat">Deleted: ' + escapeHtml(String(summary.deleted || 0)) + "</span>",
      '<span class="acp-modal-stat">Missing: ' + escapeHtml(String(summary.missing || 0)) + "</span>",
      '<span class="acp-modal-stat">Blocked: ' + escapeHtml(String(summary.blocked || 0)) + "</span>",
      '<span class="acp-modal-stat">Errors: ' + escapeHtml(String(summary.errors || 0)) + "</span>",
      "</div>"
    ];

    if (failures.length) {
      html.push('<ul class="acp-modal-list">');
      $.each(failures, function(_, failure) {
        html.push("<li>" + escapeHtml(failure.displayPath || failure.path || "") + ": " + escapeHtml(failure.message || failure.status || "Needs attention") + "</li>");
      });
      html.push("</ul>");
    }

    html.push("</div>");
    return html.join("");
  }

  function applyDeleteModalClass(className) {
    window.setTimeout(function() {
      var $modal = $(".sweet-alert");

      if (!$modal.length) {
        return;
      }

      $modal.removeClass("acp-delete-modal acp-delete-modal-review");
      if (className) {
        $modal.addClass(className);
      }
    }, 0);
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
