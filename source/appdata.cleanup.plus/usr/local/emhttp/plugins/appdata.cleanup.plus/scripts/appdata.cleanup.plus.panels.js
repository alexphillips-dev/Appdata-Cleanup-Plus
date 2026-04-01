(function(window, document, $) {
  "use strict";

  var ACP = window.AppdataCleanupPlus = window.AppdataCleanupPlus || {};

  ACP.formatOperationResultStatus = function(strings, status) {
    switch (status) {
      case "ready":
        return { label: ACP.t(strings, "previewReadyLabel", "Ready"), tone: "is-selected" };
      case "quarantined":
        return { label: ACP.t(strings, "resultQuarantinedLabel", "Quarantined"), tone: "is-safe" };
      case "deleted":
        return { label: ACP.t(strings, "resultDeletedLabel", "Deleted"), tone: "is-selected" };
      case "restored":
        return { label: ACP.t(strings, "resultRestoredLabel", "Restored"), tone: "is-safe" };
      case "purged":
        return { label: ACP.t(strings, "resultPurgedLabel", "Purged"), tone: "is-review" };
      case "skipped":
        return { label: ACP.t(strings, "resultSkippedLabel", "Skipped"), tone: "is-blocked" };
      case "conflict":
        return { label: ACP.t(strings, "resultConflictLabel", "Conflict"), tone: "is-review" };
      case "missing":
        return { label: ACP.t(strings, "resultMissingLabel", "Missing"), tone: "is-blocked" };
      case "blocked":
        return { label: ACP.t(strings, "resultBlockedLabel", "Locked"), tone: "is-review" };
      default:
        return { label: ACP.t(strings, "resultErrorLabel", "Error"), tone: "is-review" };
    }
  };

  ACP.renderModeStrip = function(context) {
    var state = context.state || {};
    var els = context.els || {};
    var strings = context.strings || {};
    var summary = (state.quarantine && state.quarantine.summary) || { count: 0, sizeLabel: "0 B" };
    var isDeleteMode = !!(state.settings && state.settings.enablePermanentDelete);
    var leftTitle = isDeleteMode
      ? ACP.t(strings, "noticeDeleteModeTitle", "Permanent delete mode is enabled")
      : ACP.t(strings, "noticeSafeModeTitle", "Safe mode is on");
    var leftMessage = isDeleteMode
      ? ACP.t(strings, "noticeDeleteModeMessage", "Selected folders will be permanently removed after confirmation. Use this mode carefully.")
      : ACP.t(strings, "noticeSafeModeMessage", "The primary action moves selected folders into quarantine instead of permanently deleting them.");
    var managerMessage = summary.count > 0
      ? summary.count + " " + (summary.count === 1 ? ACP.t(strings, "quarantineCountSingular", "quarantined folder") : ACP.t(strings, "quarantineCountPlural", "quarantined folders")) + " tracked"
      : ACP.t(strings, "quarantineSummaryEmpty", "No quarantined folders are tracked right now.");
    var managerMeta = summary.count > 0 && summary.sizeLabel ? " | " + summary.sizeLabel : "";
    var quarantineButtonLabel = state.quarantine && state.quarantine.loading
      ? ACP.t(strings, "quarantineLoadingLabel", "Loading quarantine")
      : ACP.t(strings, "quarantineManagerOpenLabel", "Show quarantine");
    var auditButtonLabel = ACP.t(strings, "auditHistoryOpenLabel", "Show history");
    var html = [
      '<div class="acp-mode-strip-grid">',
      '<article class="acp-mode-card ' + (isDeleteMode ? "is-delete-mode" : "is-safe-mode") + '">',
      '<div class="acp-mode-card-copy">',
      '<div class="acp-mode-card-title">' + ACP.escapeHtml(leftTitle) + "</div>",
      '<div class="acp-mode-card-message">' + ACP.escapeHtml(leftMessage) + "</div>",
      "</div>",
      "</article>",
      '<article class="acp-mode-card is-manager-card">',
      '<div class="acp-mode-card-copy">',
      '<div class="acp-mode-card-title">' + ACP.escapeHtml(ACP.t(strings, "actionBarTitle", "Action bar")) + "</div>",
      '<div class="acp-mode-card-message">' + ACP.escapeHtml(managerMessage + managerMeta) + "</div>",
      "</div>",
      '<div class="acp-mode-card-actions">',
      '<button type="button" class="acp-button acp-button-secondary" data-action="toggle-quarantine">' + ACP.escapeHtml(quarantineButtonLabel) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="open-audit-history">' + ACP.escapeHtml(auditButtonLabel) + "</button>",
      "</div>",
      "</article>",
      "</div>"
    ];

    els.$modeStrip.html(html.join(""));
  };

  ACP.buildQuarantineManagerModalHtml = function(context) {
    var state = context.state || {};
    var strings = context.strings || {};
    var quarantine = state.quarantine || {};
    var entries = $.isArray(quarantine.entries) ? quarantine.entries : [];
    var settings = state.settings || {};
    var defaultPurgeDays = Number(settings.defaultQuarantinePurgeDays || 0);
    var purgeAtInput = String(quarantine.purgeAtInput || "");
    var selected = quarantine.selected || {};
    var allSelected = false;
    var selectedCount = 0;
    var selectionDisabled = !!quarantine.loading || selectedCount === 0;
    var summary = quarantine.summary || { count: 0, sizeLabel: "0 B" };
    var subtitle = summary.count
      ? (summary.count + " " + (summary.count === 1 ? ACP.t(strings, "quarantineCountSingular", "quarantined folder") : ACP.t(strings, "quarantineCountPlural", "quarantined folders")) + " tracked" + (summary.sizeLabel ? " | " + summary.sizeLabel : ""))
      : ACP.t(strings, "quarantineSummaryEmpty", "No quarantined folders are tracked right now.");
    $.each(entries, function(_, entry) {
      if (selected[String(entry.id || "")]) {
        selectedCount += 1;
      }
    });
    allSelected = entries.length > 0 && selectedCount >= entries.length;
    selectionDisabled = !!quarantine.loading || selectedCount === 0;
    var html = [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-copy">',
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(subtitle) + "</div>",
      "</div>",
      '<div class="acp-modal-actions-row acp-quarantine-manager-toolbar">',
      '<div class="acp-modal-subcopy acp-quarantine-selected-summary">' + ACP.escapeHtml(selectedCount + " " + (selectedCount === 1 ? ACP.t(strings, "selectedSingular", "folder selected") : ACP.t(strings, "selectedPlural", "folders selected"))) + "</div>",
      '<div class="acp-quarantine-toolbar-groups">',
      '<div class="acp-modal-inline-actions acp-quarantine-toolbar-primary">',
      '<label class="acp-quarantine-schedule-field">',
      '<span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "quarantinePurgeScheduleDaysLabel", "Purge in days")) + "</span>",
      '<input type="number" min="0" step="1" class="acp-input acp-quarantine-default-purge-input" value="' + ACP.escapeHtml(String(defaultPurgeDays >= 0 ? defaultPurgeDays : 0)) + '"' + (quarantine.loading ? ' disabled="disabled"' : "") + '>',
      "</label>",
      '<label class="acp-quarantine-schedule-field acp-quarantine-schedule-at-field">',
      '<span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "quarantinePurgeScheduleAtLabel", "Set purge at")) + "</span>",
      '<input type="datetime-local" class="acp-input acp-quarantine-schedule-at-input" value="' + ACP.escapeHtml(purgeAtInput) + '"' + (quarantine.loading ? ' disabled="disabled"' : "") + '>',
      "</label>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="set-quarantine-purge-schedule"' + (selectionDisabled ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "quarantinePurgeScheduleSetLabel", "Set purge")) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="clear-quarantine-purge-schedule"' + (selectionDisabled ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "quarantinePurgeScheduleClearLabel", "Clear purge timer")) + "</button>",
      "</div>",
      '<div class="acp-modal-inline-actions acp-quarantine-toolbar-secondary">',
      '<button type="button" class="acp-button acp-button-secondary" data-action="refresh-quarantine"' + (quarantine.loading ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "quarantineRefreshLabel", "Refresh")) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="select-all-quarantine"' + (quarantine.loading || !entries.length || allSelected ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "selectAllLabel", "Select all")) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="clear-quarantine-selection"' + (selectionDisabled ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "clearLabel", "Clear")) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="restore-selected-quarantine"' + (selectionDisabled ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "restoreSelectedLabel", "Restore selected")) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="purge-selected-quarantine"' + (selectionDisabled ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "purgeSelectedLabel", "Purge selected")) + "</button>",
      "</div>",
      "</div>",
      "</div>",
      '<div class="acp-modal-panel">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "quarantineTrackedTitle", "Tracked folders")) + "</div>"
    ];

    if (quarantine.loading) {
      html.push('<div class="acp-utility-empty">' + ACP.escapeHtml(ACP.t(strings, "quarantineLoadingMessage", "Reviewing tracked quarantined folders.")) + "</div>");
    } else if (!entries.length) {
      html.push('<div class="acp-utility-empty">' + ACP.escapeHtml(ACP.t(strings, "quarantineEmptyMessage", "Tracked quarantine entries will appear here once folders are moved into quarantine.")) + "</div>");
    } else {
      html.push('<ul class="acp-modal-list acp-modal-result-list">');
      $.each(entries, function(_, entry) {
        var entryId = String(entry.id || "");
        var isSelected = !!selected[entryId];
        html.push('<li class="acp-modal-result acp-quarantine-entry' + (isSelected ? ' is-selected' : "") + '" data-entry-id="' + ACP.escapeHtml(entryId) + '">');
        html.push('<div class="acp-modal-result-head">');
        html.push('<div class="acp-quarantine-entry-main">');
        html.push('<label class="acp-quarantine-entry-check">');
        html.push('<input type="checkbox" class="acp-quarantine-checkbox" data-entry-id="' + ACP.escapeHtml(entryId) + '"' + (isSelected ? ' checked="checked"' : "") + ">");
        html.push("</label>");
        html.push('<div class="acp-quarantine-title-wrap">');
        html.push('<div class="acp-modal-inline-title">' + ACP.escapeHtml(entry.name || entry.sourcePath || "") + "</div>");
        if (entry.purgeScheduled && entry.purgeBadgeLabel) {
          html.push('<div class="acp-quarantine-meta-badges">');
          html.push('<span class="acp-modal-stat ' + ACP.escapeHtml(entry.purgeBadgeTone || "is-selected") + '" title="' + ACP.escapeHtml(ACP.t(strings, "quarantinePurgeScheduledLabel", "Scheduled purge") + (entry.purgeAtLabel ? ": " + entry.purgeAtLabel : "")) + '">' + ACP.escapeHtml(entry.purgeBadgeLabel) + "</span>");
          if (entry.purgeAtLabel) {
            html.push('<span class="acp-modal-stat is-scheduled" title="' + ACP.escapeHtml(ACP.t(strings, "quarantinePurgeScheduledLabel", "Scheduled purge")) + '">' + ACP.escapeHtml(entry.purgeAtLabel) + "</span>");
          }
          html.push("</div>");
        }
        html.push("</div>");
        html.push("</div>");
        html.push('<div class="acp-modal-inline-actions">');
        html.push('<button type="button" class="acp-button acp-button-secondary" data-entry-action="restore" data-entry-id="' + ACP.escapeHtml(entryId) + '">' + ACP.escapeHtml(ACP.t(strings, "quarantineRestoreActionLabel", "Restore")) + "</button>");
        html.push('<button type="button" class="acp-button acp-button-secondary" data-entry-action="purge" data-entry-id="' + ACP.escapeHtml(entryId) + '">' + ACP.escapeHtml(ACP.t(strings, "quarantinePurgeActionLabel", "Purge")) + "</button>");
        html.push("</div>");
        html.push("</div>");
        html.push('<div class="acp-modal-result-message">' + ACP.escapeHtml((entry.quarantinedAtLabel || "") + (entry.quarantinedAgeLabel ? " | " + entry.quarantinedAgeLabel : "") + (entry.sizeLabel ? " | " + entry.sizeLabel : "")) + "</div>");
        html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "quarantineSourceLabel", "Original")) + '</span><code class="acp-modal-path">' + ACP.escapeHtml(entry.sourcePath || "") + "</code></div>");
        html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "quarantineLocationLabel", "Quarantine path")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(entry.destination || "") + "</code></div>");
        html.push("</li>");
      });
      html.push("</ul>");
    }

    html.push("</div></div>");
    return html.join("");
  };

  ACP.buildAuditHistoryModalHtml = function(context) {
    var state = context.state || {};
    var strings = context.strings || {};
    var auditHistory = $.isArray(state.auditHistory) ? state.auditHistory : [];
    var subtitle = auditHistory.length
      ? (auditHistory.length + " " + ACP.t(strings, "auditHistoryEntriesLabel", "entries available"))
      : ACP.t(strings, "auditHistoryEmptySummary", "No cleanup history has been recorded yet.");
    var html = [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-copy">',
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(subtitle) + "</div>",
      "</div>",
      '<div class="acp-modal-panel acp-modal-panel-scroll">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "auditHistoryTitle", "Audit history")) + "</div>"
    ];

    if (!auditHistory.length) {
      html.push('<div class="acp-utility-empty">' + ACP.escapeHtml(ACP.t(strings, "auditHistoryEmptyMessage", "No cleanup, restore, or purge actions have been recorded yet.")) + "</div>");
    } else {
      html.push('<div class="acp-audit-list">');
      $.each(auditHistory, function(_, entry) {
        html.push('<article class="acp-audit-entry">');
        html.push('<div class="acp-audit-head">');
        html.push('<div class="acp-audit-head-main">');
        html.push('<span class="acp-modal-stat is-selected">' + ACP.escapeHtml(entry.operationLabel || "") + "</span>");
        html.push('<span class="acp-audit-time">' + ACP.escapeHtml(entry.timestampLabel || entry.timestamp || "") + "</span>");
        if (entry.relativeLabel) {
          html.push('<span class="acp-audit-time-muted">' + ACP.escapeHtml(entry.relativeLabel) + "</span>");
        }
        html.push("</div>");
        html.push('<div class="acp-audit-head-meta">' + ACP.escapeHtml(String(entry.requestedCount || 0)) + " " + ACP.escapeHtml(ACP.t(strings, "auditRequestedLabel", "items submitted")) + "</div>");
        html.push("</div>");
        html.push('<div class="acp-audit-message">' + ACP.escapeHtml(entry.message || "") + "</div>");
        html.push('<div class="acp-modal-stats">');
        $.each(entry.summary || {}, function(status, count) {
          var statusMeta;
          if (!count) {
            return;
          }
          statusMeta = ACP.formatOperationResultStatus(strings, status);
          html.push('<span class="acp-modal-stat ' + ACP.escapeHtml(statusMeta.tone) + '">' + ACP.escapeHtml(statusMeta.label) + ": " + ACP.escapeHtml(String(count)) + "</span>");
        });
        html.push("</div>");

        if ($.isArray(entry.results) && entry.results.length) {
          html.push('<div class="acp-audit-results">');
          $.each(entry.results, function(_, result) {
            var statusMeta = ACP.formatOperationResultStatus(strings, result.status);
            html.push('<div class="acp-audit-result">');
            html.push('<div class="acp-audit-result-head"><span class="acp-modal-stat ' + ACP.escapeHtml(statusMeta.tone) + '">' + ACP.escapeHtml(statusMeta.label) + "</span></div>");
            html.push('<code class="acp-modal-path">' + ACP.escapeHtml(result.displayPath || result.sourcePath || result.path || result.destination || "") + "</code>");
            if (result.destination && result.destination !== (result.displayPath || result.path || "")) {
              html.push('<div class="acp-audit-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "destinationLabel", "Destination")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(result.destination) + "</code></div>");
            }
            if (result.message) {
              html.push('<div class="acp-audit-result-message">' + ACP.escapeHtml(result.message) + "</div>");
            }
            html.push("</div>");
          });
          html.push("</div>");
        }

        html.push("</article>");
      });
      html.push("</div>");
    }

    html.push("</div></div>");
    return html.join("");
  };
})(window, document, jQuery);
