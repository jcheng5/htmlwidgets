(function() {
  // If window.HTMLWidgets is already defined, then use it; otherwise create a
  // new object. This allows preceding code to set options that affect the
  // initialization process (though none currently exist).
  window.HTMLWidgets = window.HTMLWidgets || {};
  
  // See if we're running in a viewer pane. If not, we're in a web browser.
  var viewerMode = window.HTMLWidgets.viewerMode =
      /\bviewer_pane=1\b/.test(window.location);
  // See if we're running in Shiny mode. If not, it's a static document.
  var shinyMode = window.HTMLWidgets.shinyMode =
      typeof(window.Shiny) !== "undefined" && !!window.Shiny.outputBindings;

  // We can't count on jQuery being available, so we implement our own
  // version if necessary.
  function querySelectorAll(scope, selector) {
    if (typeof(jQuery) !== "undefined" && scope instanceof jQuery) {
      return scope.find(selector);
    }
    if (scope.querySelectorAll) {
      return scope.querySelectorAll(selector);
    }
  }
  
  // Implement jQuery's extend
  function extend(target /*, ... */) {
    if (arguments.length == 1) {
      return target;
    }
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      for (var prop in source) {
        if (source.hasOwnProperty(prop)) {
          target[prop] = source[prop];
        }
      }
    }
    return target;
  }

  // Implement a vague facsimilie of jQuery's data method 
  function elementData(el, name, value) {
    if (arguments.length == 2) {
      return el["htmlwidget_data_" + name];
    } else if (arguments.length == 3) {
      el["htmlwidget_data_" + name] = value;
      return el;
    } else {
      throw new Error("Wrong number of arguments for elementData: " +
        arguments.length);
    }
  }
  
  function shouldFill(binding) {
    var cel = document.getElementById("htmlwidget_container");
    if (!cel)
      return false;

    if (binding.sizing.fillViewer === true && viewerMode)
      return true;
    if (binding.sizing.fillBrowser === true && !viewerMode)
      return true;
    return false;
  }
  
  function initSizing(el, binding) {
    var cel = document.getElementById("htmlwidget_container");

    if (!cel)
      return; // We're not in a print()-like context, nothing to do
    
    if (typeof(binding.sizing.padding) !== "undefined") {
      document.body.style.padding = binding.sizing.padding + "px";
    }
    
    if (shouldFill(binding)) {
      document.body.style.overflow = "hidden";
      document.body.style.width = "100%";
      document.body.style.height = "100%";
      document.documentElement.style.width = "100%";
      document.documentElement.style.height = "100%";
      if (cel) {
        cel.style.position = "absolute";
        cel.style.top = cel.style.right = cel.style.bottom = cel.style.left =
          binding.sizing.padding + "px";
      }
    }
    
    return {
      getWidth: function() {
        return cel.offsetWidth;
      },
      getHeight: function() {
        return cel.offsetHeight;
      }
    }
  }
  
  function onResize(el, binding) {
    if (binding.resize && shouldFill(binding)) {
      var cel = document.getElementById("htmlwidget_container");
      binding.resize(el, cel.offsetWidth, cel.offsetHeight);
    } else {
      binding.resize(el);
    }
  }
  
  // Default implementations for methods
  var defaults = {
    find: function(scope) {
      return querySelectorAll(scope, "." + this.name);
    },
    sizing: {}
  };
  
  // Called by widget bindings to register a new type of widget. The definition
  // object can contain the following properties:
  // - name (required) - A string indicating the binding name, which will be
  //   used by default as the CSS classname to look for.
  // - initialize (optional) - A function(el) that will be called once per
  //   widget element; if a value is returned, it will be passed as the third
  //   value to renderValue.
  // - renderValue (required) - A function(el, data, initValue) that will be
  //   called with data. Static contexts will cause this to be called once per
  //   element; Shiny apps will cause this to be called multiple times per
  //   element, as the data changes.
  window.HTMLWidgets.widget = function(definition) {
    if (!definition.name) {
      throw new Error("Widget must have a name");
    }
    if (!definition.type) {
      throw new Error("Widget must have a type");
    }
    // Currently we only support output widgets
    if (definition.type !== "output") {
      throw new Error("Unrecognized widget type '" + definition.type + "'");
    }
    // TODO: Verify that .name is a valid CSS classname
    if (!definition.renderValue) {
      throw new Error("Widget must have a renderValue function");
    }
    
    // Merge defaults into the definition; don't mutate the original definition.
    // The base object is a Shiny output binding if we're running in Shiny mode,
    // or an empty object if we're not.
    definition = extend(shinyMode ? new Shiny.OutputBinding() : {},
      defaults, definition
    );
    
    if (!shinyMode) {
      // We're not in a Shiny context. Use a simple widget registration scheme.
      window.HTMLWidgets.widgets = window.HTMLWidgets.widgets || [];
      window.HTMLWidgets.widgets.push(definition);
    } else {
      // It's Shiny. Register the definition as an output binding.

      if (definition.initialize) {
        // Wrap renderValue to handle initialization, which unfortunately isn't
        // supported natively by Shiny at the time of this writing.

        // Rename initialize to make sure it isn't called by a future version
        // of Shiny that does support initialize directly.
        definition._htmlwidgets_initialize = definition.initialize;
        delete definition.initialize;
        
        definition._htmlwidgets_renderValue = definition.renderValue;
        definition.renderValue = function(el, data) {
          if (!elementData(el, "initialized")) {
            initSizing(el, definition);

            elementData(el, "initialized", true);
            var result = this._htmlwidgets_initialize(el);
            elementData(el, "init_result", result);
          }
          this._htmlwidgets_renderValue(el, data,
            elementData(el, "init_result")
          );
        }
      }

      Shiny.outputBindings.register(definition, definition.name);
    }
  }

  // If not Shiny, then render after the document finishes loading
  if (!shinyMode) {
    // Statically render all elements that are of this widget's class
    function staticRender() {
      var widgets = window.HTMLWidgets.widgets || [];
      for (var i = 0; i < widgets.length; i++) {
        var widget = widgets[i];
        var matches = widget.find(document.documentElement);
        for (var j = 0; j < matches.length; j++) {
          var el = matches[j];
          var sizeObj = initSizing(el, widget);
          // TODO: Check if el is already bound
          var initResult = widget.initialize ? widget.initialize(el, sizeObj.getWidth(), sizeObj.getHeight()) : null;
          
          if (sizeObj && widget.resize) {
            // TODO: Don't depend on jQuery
            $(window).on("resize", function(e) {
              widget.resize(el, sizeObj.getWidth(), sizeObj.getHeight(), initResult);
            });
          }
          
          var scriptData = document.querySelector("script[data-for='" + el.id + "']");
          if (scriptData) {
            var data = JSON.parse(scriptData.textContent || scriptData.text);
            widget.renderValue(el, data, initResult);
          }
        }
      }
    }

    // Wait until after the document has loaded to render the widgets.
    if (document.addEventListener) {
      document.addEventListener("DOMContentLoaded", function() {
        document.removeEventListener("DOMContentLoaded", arguments.callee, false);
        staticRender();
      }, false);
    } else if (document.attachEvent) {
      document.attachEvent("onreadystatechange", function() {
        if (document.readyState === "complete") {
          document.detachEvent("onreadystatechange", arguments.callee);
          staticRender();
        }
      });
    }
  }
})();
