(function(window, document, $) {
  "use strict";

  var ACP = window.AppdataCleanupPlus = window.AppdataCleanupPlus || {};

  ACP.modalThemeTokens = [
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

  ACP.t = function(strings, key, fallback) {
    if (strings && strings[key]) {
      return strings[key];
    }

    return fallback;
  };

  ACP.defaultSafetySettings = function() {
    return {
      allowOutsideShareCleanup: false,
      enablePermanentDelete: false,
      quarantineRoot: ""
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

      plainText = String(xhr.responseText || "")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

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
  };

  ACP.applyDeleteModalClass = function(className, htmlContent) {
    var $modal = $(".sweet-alert:visible").last();
    var $baseText;
    var $existingHost;

    if (!$modal.length) {
      $modal = $(".sweet-alert.showSweetAlert").last();
    }

    if (!$modal.length) {
      return;
    }

    $baseText = $modal.children("p").first();
    $existingHost = $modal.children(".acp-modal-host");

    $modal.removeClass("acp-delete-modal acp-delete-modal-review acp-delete-results-modal acp-quarantine-manager-modal");
    if (className) {
      $modal.addClass(className);
    }

    $existingHost.remove();

    if (htmlContent) {
      if ($baseText.length) {
        $baseText.addClass("acp-modal-hidden");
        $baseText.after('<div class="acp-modal-host">' + htmlContent + "</div>");
      }
    } else if ($baseText.length) {
      $baseText.removeClass("acp-modal-hidden");
    }

    ACP.syncDeleteModalThemeTokens($modal);
  };

  ACP.syncDeleteModalThemeTokens = function($modal) {
    var appNode = document.getElementById("acp-app");
    var computed;
    var i;

    if (!$modal || !$modal.length || !appNode || !window.getComputedStyle) {
      return;
    }

    computed = window.getComputedStyle(appNode);

    for (i = 0; i < ACP.modalThemeTokens.length; i += 1) {
      $modal[0].style.setProperty(ACP.modalThemeTokens[i], computed.getPropertyValue(ACP.modalThemeTokens[i]));
    }
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
    var bodyStyle = document.body ? window.getComputedStyle(document.body) : null;
    var htmlStyle = document.documentElement ? window.getComputedStyle(document.documentElement) : null;
    var background = ACP.resolveThemeSurfaceColor(
      ACP.parseThemeColor(bodyStyle ? bodyStyle.backgroundColor : ""),
      ACP.parseThemeColor(htmlStyle ? htmlStyle.backgroundColor : ""),
      ACP.parseThemeColor("#0f1825")
    );
    var luminance = ACP.themeColorLuminance(background);

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
  };

  ACP.resolveHostThemeName = function() {
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
