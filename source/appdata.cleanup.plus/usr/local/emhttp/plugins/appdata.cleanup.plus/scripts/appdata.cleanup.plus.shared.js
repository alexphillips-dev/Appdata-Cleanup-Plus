(function(window, document, $) {
  "use strict";

  var ACP = window.AppdataCleanupPlus = window.AppdataCleanupPlus || {};

  ACP.t = function(strings, key, fallback) {
    if (strings && strings[key]) {
      return strings[key];
    }

    return ACP.tr(fallback);
  };

  ACP.tr = function(text, parameters) {
    var config = window.appdataCleanupPlusConfig || {};
    var catalog = config.catalog || {};
    var translated = Object.prototype.hasOwnProperty.call(catalog, text) ? catalog[text] : text;
    return String(translated || text || "").replace(/\{(\w+)\}/g, function(token, key) {
      return parameters && Object.prototype.hasOwnProperty.call(parameters, key) ? String(parameters[key]) : token;
    });
  };

  ACP.pluralCategory = function(count) {
    var data = (window.appdataCleanupPlusConfig || {}).plurals || {};
    var rules = data.rules || {};
    count = Math.max(0, Math.floor(Number(count) || 0));
    return Object.keys(rules).filter(function(category) {
      return category !== "other" && rules[category].some(function(terms) {
        return terms.every(function(term) {
          var value = term[0] === "n" || term[0] === "i" ? count : 0;
          if (term[1]) value %= term[1];
          var inside = term[3].some(function(range) { return value >= range[0] && value <= range[1]; });
          return inside !== term[2];
        });
      });
    })[0] || "other";
  };

  ACP.formatCount = function(count) {
    count = Math.max(0, Math.floor(Number(count) || 0));
    var config = window.appdataCleanupPlusConfig || {};
    return typeof Intl !== "undefined" && Intl.NumberFormat
      ? new Intl.NumberFormat(config.languageTag || "en-US").format(count)
      : String(count);
  };

  ACP.plural = function(text, count, parameters) {
    var config = window.appdataCleanupPlusConfig || {};
    var data = config.plurals || {};
    var forms = (data.forms || {})[text] || {};
    count = Math.max(0, Math.floor(Number(count) || 0));
    var template = forms[ACP.pluralCategory(count)] || forms.other || (count === 1 ? (data.messages || {})[text] || text : text);
    var values = $.extend({}, parameters || {}, {count: count});
    values.count = ACP.formatCount(count);
    return template.replace(/\{(\w+)\}/g, function(token, key) { return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : token; });
  };

  ACP.localizePresentation = function(value, field) {
    var config = window.appdataCleanupPlusConfig || {};
    var language = config.languageTag || "en-US";
    var dates = {timestampLabel: "timestamp", lastModifiedExact: "lastModified", quarantinedAtLabel: "quarantinedAt", purgeAtLabel: "purgeAt", ignoredAtLabel: "ignoredAt"};
    var ages = {lastModifiedLabel: "lastModified", quarantinedAgeLabel: "quarantinedAt", relativeLabel: "timestamp"};
    if (!value || typeof value !== "object" || ["bundle", "diagnostics", "settings", "metrics", "supportLogs", "environment", "privacy", "snapshot"].indexOf(field) !== -1) return value;
    Object.keys(value).forEach(function(key) { value[key] = ACP.localizePresentation(value[key], key); });
    if (typeof Intl === "undefined") return value;
    Object.keys(dates).forEach(function(label) {
      var raw = value[dates[label]];
      var date = new Date(typeof raw === "number" ? raw * 1000 : raw);
      if (!raw || !Object.prototype.hasOwnProperty.call(value, label) || !isFinite(date.getTime())) return;
      try { value[label] = new Intl.DateTimeFormat(language, {dateStyle: "medium", timeStyle: "short", timeZone: config.timeZone || undefined}).format(date); } catch (_error) {}
    });
    Object.keys(ages).forEach(function(label) {
      var raw = value[ages[label]];
      var date = new Date(typeof raw === "number" ? raw * 1000 : raw);
      var seconds = (date.getTime() - Date.now()) / 1000;
      var units = [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [60, "minute"]];
      if (!raw || !Object.prototype.hasOwnProperty.call(value, label) || !isFinite(seconds) || !Intl.RelativeTimeFormat) return;
      if (Math.abs(seconds) < 60) { value[label] = ACP.tr("Just now"); return; }
      units.some(function(unit) {
        if (Math.abs(seconds) < unit[0]) return false;
        value[label] = new Intl.RelativeTimeFormat(language, {numeric: "auto"}).format(Math.trunc(seconds / unit[0]), unit[1]);
        return true;
      });
    });
    if (typeof value.sizeBytes === "number" && value.sizeBytes > 0 && Object.prototype.hasOwnProperty.call(value, "sizeLabel")) {
      var unit = Math.min(4, Math.floor(Math.log(value.sizeBytes) / Math.log(1024)));
      var amount = value.sizeBytes / Math.pow(1024, unit);
      value.sizeLabel = new Intl.NumberFormat(language, {maximumFractionDigits: unit && amount < 10 ? 1 : 0}).format(amount) + " " + ["B", "KB", "MB", "GB", "TB"][unit];
    }
    return value;
  };

  ACP.defaultSafetySettings = function() {
    return {
      enablePermanentDelete: false,
      enableZfsDatasetDelete: true,
      quarantineRoot: "",
      defaultQuarantinePurgeDays: 0,
      manualAppdataSources: [],
      zfsPathMappings: []
    };
  };

  ACP.buildApiRequestData = function(config, data) {
    return $.extend({
      csrfToken: String((config && config.csrfToken) || "")
    }, data || {});
  };

  ACP.escapeHtml = function(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  ACP.extractErrorMessage = function(xhr, fallback) {
    var responseJSON = xhr && xhr.responseJSON;
    var plainText;

    if (responseJSON && responseJSON.message) {
      return String(responseJSON.message);
    }

    if (xhr && xhr.responseText) {
      try {
        responseJSON = JSON.parse(xhr.responseText);
        if (responseJSON && responseJSON.message) {
          return String(responseJSON.message);
        }
      } catch (_error) {}

      plainText = String(xhr.responseText || "");

      // Do not try to make arbitrary HTML safe with regular expressions. If
      // an upstream server returned markup, use the generic error below. This
      // keeps malformed tags out of SweetAlert while preserving useful plain
      // text responses.
      if (plainText.indexOf("<") !== -1 || plainText.indexOf(">") !== -1) {
        plainText = "";
      } else {
        plainText = plainText.replace(/\s+/g, " ").trim();
      }

      if (plainText) {
        return plainText.slice(0, 240);
      }
    }

    if (xhr && xhr.status) {
      return fallback + " (HTTP " + String(xhr.status) + ")";
    }

    return fallback;
  };

  ACP.normalizeHostThemeName = function(value) {
    var normalized = String(value || "").trim().toLowerCase();

    if (normalized === "grey") {
      return "gray";
    }

    return normalized;
  };

  ACP.applyThemeState = function($app) {
    var themeName = ACP.resolveHostThemeName();
    var themeClass = ACP.inferThemeClass(themeName);
    var appNode = $app && $app.length ? $app[0] : null;

    if (!appNode) {
      return;
    }

    if (themeName) {
      $app.attr("data-acp-host-theme", themeName);
    } else {
      $app.removeAttr("data-acp-host-theme");
    }

    if (themeClass) {
      $app.attr("data-acp-theme-class", themeClass);
    } else {
      $app.removeAttr("data-acp-theme-class");
    }

    appNode.style.colorScheme = themeClass === "light" ? "light" : "dark";
  };

  ACP.watchThemeChanges = function(onChange) {
    var observer;
    var options = {
      attributes: true,
      attributeFilter: ["class", "style", "data-acp-host-theme", "data-theme", "theme", "data-color-scheme", "data-bs-theme"]
    };

    if (typeof window.MutationObserver !== "function") {
      return;
    }

    observer = new window.MutationObserver(function() {
      onChange();
    });

    if (document.body) {
      observer.observe(document.body, options);
    }

    if (document.documentElement) {
      observer.observe(document.documentElement, options);
    }

    if (document.head) {
      observer.observe(document.head, {subtree: true, childList: true, attributes: true, attributeFilter: ["href", "media", "disabled"]});
      document.head.addEventListener("load", function(event) {
        if (event.target && event.target.tagName === "LINK") onChange();
      }, true);
    }
  };

  ACP.applyDeleteModalClass = function(className, htmlContent) {
    var $modal = $(".sweet-alert:visible").last();
    var $baseText;
    var $existingHost;
    var $anchor;
    var $buttonContainer;

    if (!$modal.length) {
      $modal = $(".sweet-alert.showSweetAlert").last();
    }

    if (!$modal.length) {
      return;
    }

    $modal.attr("dir", (window.appdataCleanupPlusConfig || {}).direction || "ltr");
    $modal.attr("lang", (window.appdataCleanupPlusConfig || {}).languageTag || "en-US");

    $baseText = $modal.children("p").first();
    $existingHost = $modal.children(".acp-modal-host");

    // Flex sizing keeps the template list scrollable without moving the footer.
    // Preserve SweetAlert's inline display:none when closing or reusing a dialog.
    if ($modal[0].style.display !== "none" && ($modal.hasClass("acp-template-manager-modal") || String(className).indexOf("acp-template-manager-modal") !== -1)) {
      $modal.css("display", String(className).indexOf("acp-template-manager-modal") !== -1 ? "flex" : "block");
    }

    $modal.removeClass("acp-delete-modal acp-delete-modal-review acp-delete-results-modal acp-delete-progress-running acp-delete-progress-ready acp-quarantine-manager-modal acp-audit-history-modal acp-appdata-sources-modal acp-zfs-path-mappings-modal acp-tools-modal acp-template-manager-modal acp-help-modal acp-row-details-modal");
    if (className) {
      $modal.addClass(className);
    }

    $existingHost.remove();

    if (htmlContent) {
      if ($baseText.length) {
        $baseText.addClass("acp-modal-hidden");
        $baseText.after('<div class="acp-modal-host">' + htmlContent + "</div>");
      } else {
        $anchor = $modal.children("h2").first();
        $buttonContainer = $modal.children(".sa-button-container, .sa-confirm-button-container").first();

        if ($anchor.length) {
          $anchor.after('<div class="acp-modal-host">' + htmlContent + "</div>");
        } else if ($buttonContainer.length) {
          $buttonContainer.before('<div class="acp-modal-host">' + htmlContent + "</div>");
        } else {
          $modal.append('<div class="acp-modal-host">' + htmlContent + "</div>");
        }
      }
    } else if ($baseText.length) {
      $baseText.removeClass("acp-modal-hidden");
    }

    ACP.syncDeleteModalThemeTokens($modal);
  };

  ACP.releaseModalScrollLock = function(forceUnlock) {
    var hasVisibleModal = $(".sweet-alert:visible, .sweet-alert.showSweetAlert").length > 0;
    var nodes;

    if (!forceUnlock && hasVisibleModal) {
      return;
    }

    $(".sweet-overlay").hide().removeClass("showSweetOverlay");
    $("body, html").removeClass("stop-scrolling swal2-shown");

    nodes = [document.body, document.documentElement];
    $.each(nodes, function(_, node) {
      if (!node || !node.style) {
        return;
      }

      node.style.removeProperty("overflow");
      node.style.removeProperty("padding-right");
      node.style.removeProperty("height");
      node.style.removeProperty("position");
      node.style.removeProperty("top");
      node.style.removeProperty("width");
    });
  };

  ACP.syncDeleteModalThemeTokens = function($modal) {
    var appNode = document.getElementById("acp-app");
    if (!$modal || !$modal.length || !appNode) {
      return;
    }
    // Dialogs live outside #acp-app. Share theme identity, not a partial snapshot
    // of resolved colors that becomes stale after a theme change or modal reuse.
    $modal.attr("data-acp-host-theme", appNode.getAttribute("data-acp-host-theme") || "");
    $modal.attr("data-acp-theme-class", appNode.getAttribute("data-acp-theme-class") || "");
    $modal.each(function() {
      for (var i = this.style.length - 1; i >= 0; i -= 1) {
        if (this.style[i].indexOf("--acp-") === 0) this.style.removeProperty(this.style[i]);
      }
    });
  };

  ACP.parseThemeColor = function(value) {
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
          r: ACP.clampThemeChannel(parseInt(hex.charAt(0) + hex.charAt(0), 16)),
          g: ACP.clampThemeChannel(parseInt(hex.charAt(1) + hex.charAt(1), 16)),
          b: ACP.clampThemeChannel(parseInt(hex.charAt(2) + hex.charAt(2), 16)),
          a: 1
        };
      }

      if (hex.length === 6) {
        return {
          r: ACP.clampThemeChannel(parseInt(hex.slice(0, 2), 16)),
          g: ACP.clampThemeChannel(parseInt(hex.slice(2, 4), 16)),
          b: ACP.clampThemeChannel(parseInt(hex.slice(4, 6), 16)),
          a: 1
        };
      }
    }

    rgbMatch = trimmed.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i);
    if (!rgbMatch) {
      return null;
    }

    return {
      r: ACP.clampThemeChannel(rgbMatch[1]),
      g: ACP.clampThemeChannel(rgbMatch[2]),
      b: ACP.clampThemeChannel(rgbMatch[3]),
      a: ACP.clampThemeAlpha(rgbMatch[4] !== undefined ? rgbMatch[4] : 1)
    };
  };

  ACP.resolveThemeSurfaceColor = function() {
    var i;
    var color;

    for (i = 0; i < arguments.length; i += 1) {
      color = arguments[i];
      if (color && ACP.clampThemeAlpha(color.a !== undefined ? color.a : 1) >= 0.08) {
        return color;
      }
    }

    for (i = 0; i < arguments.length; i += 1) {
      if (arguments[i]) {
        return arguments[i];
      }
    }

    return null;
  };

  ACP.resolveHostSurfaceColor = function() {
    var candidates = [];
    var selectors = [
      "#content",
      ".content",
      "#main",
      "main",
      ".page",
      ".canvas",
      ".template"
    ];
    var i;
    var node;
    var style;

    for (i = 0; i < selectors.length; i += 1) {
      node = document.querySelector ? document.querySelector(selectors[i]) : null;
      if (node && window.getComputedStyle) {
        style = window.getComputedStyle(node);
        candidates.push(ACP.parseThemeColor(style ? style.backgroundColor : ""));
      }
    }

    if (document.body && window.getComputedStyle) {
      style = window.getComputedStyle(document.body);
      candidates.push(ACP.parseThemeColor(style ? style.backgroundColor : ""));
    }

    if (document.documentElement && window.getComputedStyle) {
      style = window.getComputedStyle(document.documentElement);
      candidates.push(ACP.parseThemeColor(style ? style.backgroundColor : ""));
    }

    return ACP.resolveThemeSurfaceColor.apply(ACP, candidates);
  };

  ACP.themeColorLuminance = function(color) {
    var channels;

    if (!color) {
      return 0;
    }

    channels = [color.r, color.g, color.b];
    return (0.2126 * ACP.normalizeChannel(channels[0])) + (0.7152 * ACP.normalizeChannel(channels[1])) + (0.0722 * ACP.normalizeChannel(channels[2]));
  };

  ACP.inferThemeClass = function(themeName) {
    var normalized = ACP.normalizeHostThemeName(themeName);
    var background = ACP.resolveHostSurfaceColor();
    var luminance = ACP.themeColorLuminance(background);

    if (normalized.indexOf("white") !== -1 || normalized.indexOf("light") !== -1 || normalized === "azure") {
      return "light";
    }

    if (normalized.indexOf("black") !== -1 || normalized === "gray") {
      return "dark";
    }

    if (!background) {
      background = ACP.parseThemeColor("#0f1825");
      luminance = ACP.themeColorLuminance(background);
    }

    if (luminance >= 0.58) {
      return "light";
    }

    if (luminance <= 0.45) {
      return "dark";
    }

    return "mixed";
  };

  ACP.resolveHostThemeName = function() {
    var links = document.querySelectorAll ? document.querySelectorAll('link[rel="stylesheet"]') : [];
    var theme = "";
    for (var i = 0; i < links.length; i += 1) {
      var match = String(links[i].href || "").match(/\/(?:themes\/|default-|dynamix-)(black|white|azure|gray)\.css(?:[?#]|$)/i);
      if (match && !links[i].disabled && (!links[i].media || !window.matchMedia || window.matchMedia(links[i].media).matches)) theme = match[1];
    }
    if (theme) return ACP.normalizeHostThemeName(theme);
    return ACP.normalizeHostThemeName(
      (document.documentElement && document.documentElement.getAttribute("data-acp-host-theme"))
      || (document.body && document.body.getAttribute("data-acp-host-theme"))
      || window.AppdataCleanupPlusHostThemeName
      || ""
    );
  };

  ACP.clampThemeChannel = function(value) {
    var numeric = Number(value);

    if (isNaN(numeric)) {
      numeric = 0;
    }

    return Math.max(0, Math.min(255, numeric));
  };

  ACP.clampThemeAlpha = function(value) {
    var numeric = Number(value);

    if (isNaN(numeric)) {
      numeric = 1;
    }

    return Math.max(0, Math.min(1, numeric));
  };

  ACP.normalizeChannel = function(channel) {
    var value = ACP.clampThemeChannel(channel) / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
})(window, document, jQuery);
