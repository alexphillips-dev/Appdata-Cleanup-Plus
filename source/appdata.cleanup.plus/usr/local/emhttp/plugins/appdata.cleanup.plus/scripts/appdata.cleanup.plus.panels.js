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
      case "missing":
        return { label: ACP.t(strings, "resultMissingLabel", "Missing"), tone: "is-blocked" };
      case "blocked":
        return { label: ACP.t(strings, "resultBlockedLabel", "Blocked"), tone: "is-review" };
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
    var buttonLabel = state.quarantine && state.quarantine.loading
      ? ACP.t(strings, "quarantineLoadingLabel", "Loading manager")
      : ACP.t(strings, "quarantineManagerOpenLabel", "Open manager");
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
      '<div class="acp-mode-card-title">' + ACP.escapeHtml(ACP.t(strings, "quarantineManagerTitle", "Quarantine manager")) + "</div>",
      '<div class="acp-mode-card-message">' + ACP.escapeHtml(managerMessage + managerMeta) + "</div>",
      "</div>",
      '<div class="acp-mode-card-actions">',
      '<button type="button" class="acp-button acp-button-secondary" data-action="toggle-quarantine">' + ACP.escapeHtml(buttonLabel) + "</button>",
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
    var summary = quarantine.summary || { count: 0, sizeLabel: "0 B" };
    var subtitle = summary.count
      ? (summary.count + " " + (summary.count === 1 ? ACP.t(strings, "quarantineCountSingular", "quarantined folder") : ACP.t(strings, "quarantineCountPlural", "quarantined folders")) + " tracked" + (summary.sizeLabel ? " | " + summary.sizeLabel : ""))
      : ACP.t(strings, "quarantineSummaryEmpty", "No quarantined folders are tracked right now.");
    var html = [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-copy">',
      '<div class="acp-modal-lead">' + ACP.escapeHtml(ACP.t(strings, "quarantineManagerTitle", "Quarantine manager")) + "</div>",
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(subtitle) + "</div>",
      "</div>",
      '<div class="acp-modal-actions-row">',
      '<button type="button" class="acp-button acp-button-secondary" data-action="refresh-quarantine">' + ACP.escapeHtml(ACP.t(strings, "quarantineRefreshLabel", "Refresh")) + "</button>",
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
        html.push('<li class="acp-modal-result">');
        html.push('<div class="acp-modal-result-head">');
        html.push('<div class="acp-modal-inline-title">' + ACP.escapeHtml(entry.name || entry.sourcePath || "") + "</div>");
        html.push('<div class="acp-modal-inline-actions">');
        html.push('<button type="button" class="acp-button acp-button-secondary" data-entry-action="restore" data-entry-id="' + ACP.escapeHtml(entry.id || "") + '">' + ACP.escapeHtml(ACP.t(strings, "quarantineRestoreActionLabel", "Restore")) + "</button>");
        html.push('<button type="button" class="acp-button acp-button-secondary" data-entry-action="purge" data-entry-id="' + ACP.escapeHtml(entry.id || "") + '">' + ACP.escapeHtml(ACP.t(strings, "quarantinePurgeActionLabel", "Purge")) + "</button>");
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

  ACP.renderAuditPanel = function(context) {
    var state = context.state || {};
    var els = context.els || {};
    var strings = context.strings || {};
    var auditHistory = $.isArray(state.auditHistory) ? state.auditHistory : [];
    var isOpen = !!state.auditOpen;
    var buttonLabel = isOpen
      ? ACP.t(strings, "auditHistoryCloseLabel", "Hide history")
      : ACP.t(strings, "auditHistoryOpenLabel", "Show history");
    var html = [
      '<section class="acp-utility-card">',
      '<div class="acp-utility-head">',
      '<div class="acp-utility-copy">',
      '<div class="acp-utility-title">' + ACP.escapeHtml(ACP.t(strings, "auditHistoryTitle", "Audit history")) + "</div>",
      '<div class="acp-utility-subtitle">' + ACP.escapeHtml(auditHistory.length ? (auditHistory.length + " " + ACP.t(strings, "auditHistoryEntriesLabel", "entries available")) : ACP.t(strings, "auditHistoryEmptySummary", "No cleanup history has been recorded yet.")) + "</div>",
      "</div>",
      '<div class="acp-utility-actions">',
      '<button type="button" class="acp-button acp-button-secondary" data-action="toggle-audit">' + ACP.escapeHtml(buttonLabel) + "</button>",
      "</div>",
      "</div>"
    ];

    if (isOpen) {
      html.push('<div class="acp-utility-body">');

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

      html.push("</div>");
    }

    html.push("</section>");
    els.$auditPanel.html(html.join(""));
  };

  ACP.renderQuarantinePanel = function(context) {
    var els = context.els || {};
    els.$quarantinePanel.empty();
  };
})(window, document, jQuery);
