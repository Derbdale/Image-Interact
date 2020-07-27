declare var panzoom:any;

const ImageInteractEditor = (function():Function{
  const VERSION = "1.0.0";

  /* -- Enums and Interfaces -- */
  //Types for the SVG Polygon points.
  enum PointType {
    Circle = "circle",
    Square = "rect"
  }

  //Modes for the editor.
  enum Mode {
    Delete = "delete",
    Pan = "pan",
    Poly = "poly",
    Point = "point",
    Select = "select",
  }

  //Point (x,y)
  interface Point {
    x: number,
    y: number
  }

  interface PredictedPoint extends Point{
    insertAt: number;
  }

  //Info about an element of an image map.
  interface Decoration {
    type:string,
    data:any,
    options: {}
  }

  //Info about polygon decoration.
  interface PolyDecoration extends Decoration {
    type: "poly",
    data: Array<Point>
  }

  //Info about point decoration.
  interface PointDecoration extends Decoration {
    type: "point",
    data: Point
  }

  //Info about recognised plugins.
  interface Plugins {
    panzoom?:any,
  }

  //Info about the configuration
  interface Config {
    constraintsEnabled:boolean,
    eventHandler:HTMLElement,
    pointType:PointType,
    pointSize:number,
    scaleFrom:number,
    plugins:Plugins,
  }

  /* -- Helper Functions -- */
  /**
   * Extend an object.
   * @param o1
   * @param o2
   */
  function extend(o1:object, o2:object):void{
    for (let prop in o2) {
      if (o2.hasOwnProperty(prop)) {
        // @ts-ignore
        o1[prop] = o2[prop];
      }
    }
  }

  /**
   * Calculate the length of a line segment.
   * @param a - The start point.
   * @param b - The end point.
   */

  function lineLength(a:Point, b:Point):number{
    let ax = a.x,
      ay = a.y,
      bx = b.x,
      by = b.y;
    return Math.sqrt((ax -= bx) * ax + (ay -= by) * ay);
  }

  /**
   * Get the distance between a point and a line segment.
   * @param p - The target point.
   * @param a - The start point of the line segment.
   * @param b - The end point of the line segment.
   */
  function pointToLineDistance(p:Point, a:Point, b:Point):number {
    let o:Point;

    //If line is horizontal or vertical return the length now.
    if (!(b.x - a.x)) {
      o = {x: a.x, y: p.y};
    } else if (!(b.y - a.y)) {
      o = {x: p.x, y: a.y};
    } else {
      //Initialise left and tangent (-1/(dy/dx)) parameters.
      let left:number, tg:number = -1 / ((b.y - a.y) / (b.x - a.x));
      //Get the distance if the line represents the x axis.
      o = {
        x: left = (b.x * (p.x * tg - p.y + a.y) + a.x * (p.x * -tg + p.y - b.y)) / (tg * (b.x - a.x) + a.y - b.y),
        y: tg * left - tg * p.x + p.y
      };
    }

    //Check if the point falls outside the range of the segment.
    if (o.x < Math.min(a.x, b.x) || o.x > Math.max(a.x, b.x) || o.y < Math.min(a.y, b.y) || o.y > Math.max(a.y, b.y)) {
      //Get the length from the point to either the start/end point.
      const l1:number = lineLength(p, a), l2:number = lineLength(p, b);
      return l1 > l2 ? l2 : l1;
    } else {
      //Calculate the length from the point to the line using the formula |Ax+By+C|÷√A²+B²
      const A:number = a.y - b.y,
        B:number = b.x - a.x,
        C:number = a.x * b.y - a.y * b.x;
      return Math.abs(A * p.x + B * p.y + C) / Math.sqrt(A * A + B * B);
    }
  }

  /**
   * Get the closest point that actually falls on the line segment.
   * @param p - The target point.
   * @param a - The start point of the line segment.
   * @param b - The end point of the line segment.
   */
  function closestPointOnLine(p:Point, a:Point, b:Point):Point{
    const apx:number = p.x - a.x;
    const apy:number = p.y - a.y;
    const abx:number = b.x - a.x;
    const aby:number = b.y - a.y;

    const ab2:number = abx * abx + aby * aby;
    const ap_ab:number = apx * abx + apy * aby;
    const t:number = Math.min(1, Math.max(0, ap_ab / ab2));

    return {
      x: a.x + abx * t,
      y: a.y + aby * t
    };
  }

  /* -- Main Code -- */
  return class ImageInteractEditor {
    //The current version number
    public readonly version = VERSION;
    //The settings.
    private readonly settings:Config;

    //Stores a list of decorations.
    private decorations:Array<Decoration> = [];
    //Stores the current decoration index.
    private currentDecoration:number = 0;
    //Stores the target from an event.
    private target:HTMLElement;
    //Stores the index of the current point.
    private pointIndex:number;
    //Stores the last known position.
    private position:Point;
    //Stores the last known width.
    private lastWidth:number;
    //Stores a predicted point when necessary.
    private predictedPoint:PredictedPoint = null;
    //Stores the panzoom instance if necessary.
    private readonly panzoom:any;

    //Stores the current editor mode.
    private mode:Mode;

    //Stores the markup making the editor.
    private readonly svg:SVGElement;
    private readonly container:HTMLElement;
    private readonly wrapper:HTMLElement;
    private readonly editor:HTMLElement;

    constructor(element:HTMLElement, settings?:Config) {
      //Allow "this" to be accessed within functions.
      const instance = this;

      //Setup the settings.
      this.settings = {
        constraintsEnabled: true,
        eventHandler: element,
        pointType: PointType.Circle,
        pointSize: 10,
        scaleFrom: undefined,
        plugins: {},
      }
      if(settings !== undefined) {
        extend(this.settings, settings);
      }

      //Set the last width.
      this.lastWidth = element.offsetWidth;

      /* Build the svg element */
      this.svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
      this.svg.classList.add('image-interact-editor-svg');

      /* Build the wrappers for the image and SVG */
      this.container = document.createElement('div');
      this.container.className = 'image-interact-editor-container';

      this.wrapper = document.createElement('div');
      this.wrapper.className = 'image-interact-editor-wrapper';

      this.editor = document.createElement('div');
      this.editor.className = 'image-interact-editor';

      //Add the markup to the page.
      element.parentNode.insertBefore(this.container, element);
      this.container.appendChild(this.wrapper);
      // this.container.appendChild(ui);
      this.wrapper.appendChild(this.editor);
      this.editor.appendChild(element);
      this.editor.appendChild(this.svg);

      //Disable right click context menu.
      this.editor.oncontextmenu = function(e){
        e.preventDefault();
        return false;
      }

      //Check for panzoom functionality.
      if(this.settings.plugins.panzoom !== undefined){
        if(panzoom !== undefined) {
          const defaults = {
            bounds: true,
            boundsPadding: 1,
            minZoom: 1,
            maxZoom: 10,
            beforeMouseDown: instance.allowPanning.bind(this),
            smoothScroll: false
          };
          const options = this.settings.plugins.panzoom.options !== undefined ? this.settings.plugins.panzoom.options : {}
          extend(options, defaults);
          this.panzoom = panzoom(this.editor, options);
          // this.wrapper.addEventListener('wheel', this.panzoom.zoomWithWheel);
          this.wrapper.addEventListener('wheel', function(){
            instance.render();
          });
        }else{
          console.log('Image Interact: Panzoom Library not found!');
        }
      }

      //Check if a map needs to be loaded as the default.
      if(element.getAttribute('usemap') !== null){
        const map = document.querySelector('map[name="' + element.getAttribute('usemap').substr(1) +'"]');
        const scale = this.settings.scaleFrom !== undefined ? element.offsetWidth / this.settings.scaleFrom : 1;

        const areas = map.querySelectorAll('area');
        areas.forEach(function(area){
          instance.decorations[instance.currentDecoration] = {
            type: "poly",
            data: [],
            options: {}
          };
          const coords = area.getAttribute('coords');
          if(coords !== '' && coords !== '0'){
            const points:Array<number> = coords.split(',').map(function(str){
              return <number><unknown>(str);
            });
            for(let i = 0; i < points.length; i+= 2){
              instance.decorations[instance.currentDecoration].data.push({x: Math.round(points[i] * scale), y: Math.round(points[i + 1] * scale)});
            }
          }
        });
        element.removeAttribute('usemap');

        //Render the SVG.
        this.render();
      }

      //Start in polygon mode by default;
      this.switchMode(Mode.Poly);

      this.editor.onpointerdown = this.mouseDown.bind(instance);
      this.editor.onpointermove = this.mouseMove.bind(instance);
      this.editor.onpointerup = this.mouseUp.bind(instance);
    }

    private allowPanning(){
      return (this.mode != Mode.Pan);
    }

    private mouseDown(e:MouseEvent) {
      if(this.mode !== Mode.Poly){
        return;
      }else {
        e.stopPropagation();
      }
      if (this.currentDecoration === undefined) {
        return false;
      }
      this.target = <HTMLElement>e.target;
      if (e.button === 0) {
        this.pointIndex = undefined;
        const rect = this.editor.getBoundingClientRect();

        let p = {
          x: e.pageX - rect.left + document.body.scrollLeft,
          y: e.pageY - rect.top + document.body.scrollTop
        }
        this.scalePoint(p);

        if (this.decorations[this.currentDecoration] === undefined) {
          this.decorations[this.currentDecoration] = {
            type: "poly",
            data: [],
            options: {}
          };
        }

        if (this.target.tagName.toLowerCase() === 'svg' || (<number><unknown>this.target.getAttribute('data-shape-index') * 1) !== this.currentDecoration) {
          if(this.predictedPoint !== null){
            this.pointIndex = this.predictedPoint.insertAt;
            this.decorations[this.currentDecoration].data.splice(this.pointIndex, 0, p);
            this.predictedPoint = null;
          }else {
            this.pointIndex = this.decorations[this.currentDecoration].data.length;
            this.decorations[this.currentDecoration].data[this.pointIndex] = p;
          }
        } else if (this.target.tagName.toLowerCase() === this.settings.pointType) {
          this.pointIndex = <number><unknown>this.target.getAttribute('data-point-index');
          this.decorations[this.currentDecoration].data[this.pointIndex] = p;
        } else if (this.target.tagName.toLowerCase() === 'polygon') {
          if(this.predictedPoint !== null) {
            this.pointIndex = this.predictedPoint.insertAt;
            this.decorations[this.currentDecoration].data.splice(this.pointIndex, 0, p);
            this.target = this.target.parentElement;
            this.predictedPoint = null;
          }else {
            this.pointIndex = this.decorations[this.currentDecoration].data.length;
          }
          this.position = p;
        }
      } else if (e.button === 2) {
        if (this.target.tagName.toLowerCase() === this.settings.pointType && (<number><unknown>this.target.getAttribute('data-shape-index')  * 1) === this.currentDecoration) {
          this.pointIndex = <number><unknown>this.target.getAttribute('data-point-index');
          this.decorations[this.currentDecoration].data.splice(this.pointIndex, 1);
        }
        this.pointIndex = undefined;
        this.target = undefined;
      }
      this.render();
    }

    private mouseMove(e:MouseEvent) {
      const rect = this.editor.getBoundingClientRect();

      let p = {
        x: e.pageX - rect.left + document.body.scrollLeft,
        y: e.pageY - rect.top + document.body.scrollTop
      }
      this.scalePoint(p);

      if(this.predictedPoint !== null){
        this.predictedPoint = null;
        this.render();
      }

      if(e.buttons === 0) {
        const moveTarget = <HTMLElement>e.target;
        if ((!moveTarget.classList.contains('image-interact-point') || moveTarget.classList.contains('ghost')) && this.decorations[this.currentDecoration] !== undefined) {
          const lastPoint = this.decorations[this.currentDecoration].data[this.decorations[this.currentDecoration].data.length - 1];
          let closest = 21;
          for (let i = 0; i < this.decorations[this.currentDecoration].data.length - 1; i++) {
            const dist = pointToLineDistance(p, this.decorations[this.currentDecoration].data[i], this.decorations[this.currentDecoration].data[i + 1]);
            if (dist <= 20) {
              if (dist < closest) {
                const segmentStart = this.decorations[this.currentDecoration].data[i];
                const segmentEnd = this.decorations[this.currentDecoration].data[i + 1];
                const closestPoint = closestPointOnLine(p, segmentStart, segmentEnd);
                const distToLastPoint = lineLength(p, lastPoint);
                let predict = false;
                if(segmentEnd.x === lastPoint.x && segmentEnd.y === lastPoint.y){
                  if(dist < distToLastPoint/2) {
                    predict = true;
                  }
                }else{
                  if(dist < distToLastPoint) {
                    predict = true;
                  }
                }
                if(predict) {
                  this.predictedPoint = {
                    x: closestPoint.x,
                    y: closestPoint.y,
                    insertAt: i + 1,
                  }
                  closest = dist;
                }
              }
            }
          }
          if (this.predictedPoint !== null) {
            this.render();
          }
        }
      }

      if(this.mode !== Mode.Poly){
        return;
      }else {
        e.stopPropagation();
      }
      if (this.currentDecoration === undefined) {
        return false;
      }
      if (this.target !== undefined) {
        if (this.target.tagName.toLowerCase() === 'polygon' && (<number><unknown>this.target.getAttribute('data-shape-index')  * 1) === this.currentDecoration && this.predictedPoint === null) {
          if (this.pointIndex !== undefined) {
            this.decorations[this.currentDecoration].data.splice(this.pointIndex, 1);
            this.pointIndex = undefined;
          }

          this.movePoly(<PolyDecoration>this.decorations[this.currentDecoration], p.x - this.position.x, p.y - this.position.y);
          this.position = p;
        } else {
          if (this.pointIndex !== undefined) {
            if (e.shiftKey && this.settings.constraintsEnabled) {
              var lastPoint = this.decorations[this.currentDecoration].data[this.pointIndex - 1];
              var delta_x = p.x - lastPoint.x;
              var delta_y = p.y - lastPoint.y;
              var angle = Math.atan2(delta_y, delta_x) * 180 / Math.PI;

              if ((angle < 45 && angle > -45) || (angle > 157.5 || angle < -157.5)) {
                p.y = lastPoint.y;
              } else {
                p.x = lastPoint.x;
              }
            }
            this.decorations[this.currentDecoration].data[this.pointIndex] = p;
          }
        }
        this.render();
      }
    }

    private mouseUp (e:MouseEvent) {
      if(e.button === 1){
        if(this.mode != Mode.Pan) {
          this.switchMode(Mode.Pan);
        }else{
          this.switchMode(Mode.Poly);
        }
      }
      if(this.mode !== Mode.Poly){
        return;
      }else {
        e.stopPropagation();
      }
      if (this.currentDecoration === undefined) {
        return false;
      }
      if (this.pointIndex !== undefined) {
        const rect = this.editor.getBoundingClientRect();

        let p = {
          x: e.pageX - rect.left + document.body.scrollLeft,
          y: e.pageY - rect.top + document.body.scrollTop
        }
        this.scalePoint(p);

        if (e.shiftKey && this.settings.constraintsEnabled) {
          var lastPoint = this.decorations[this.currentDecoration].data[this.pointIndex - 1];
          var delta_x = p.x - lastPoint.x;
          var delta_y = p.y - lastPoint.y;
          var angle = Math.atan2(delta_y, delta_x) * 180 / Math.PI;

          if ((angle < 45 && angle > -45) || (angle > 157.5 || angle < -157.5)) {
            p.y = lastPoint.y;
          } else {
            p.x = lastPoint.x;
          }
        }

        if(this.predictedPoint !== null) {
          this.decorations[this.currentDecoration].data.splice(this.pointIndex, 0, p);
        }else {
          this.decorations[this.currentDecoration].data[this.pointIndex] = p;
        }
      }
      this.pointIndex = undefined;
      this.render();
      this.target = undefined;
    }

    render(){
      const instance = this;
      //Get the scale modifier.
      const scaleModifier:number = this.panzoom !== undefined ? (this.panzoom.getTransform().scale > 10 ? 0.2 : 1 / (this.panzoom.getTransform().scale)) : 1;
      //Remove all elements from SVG.
      while(this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

      function generateHandle(p:Point, classes:Array<string>, scaleModifier:number){
        const point = document.createElementNS('http://www.w3.org/2000/svg', instance.settings.pointType);
        point.classList.add('image-interact-point');
        if(classes.length !== 0){
          for(let i = 0; i < classes.length; i++){
            point.classList.add(classes[i]);
          }
        }
        if (instance.settings.pointType === 'circle') {
          point.setAttribute('r', <string><unknown>(instance.settings.pointSize / 2 * scaleModifier));
          point.setAttribute('cx', <string><unknown>p.x);
          point.setAttribute('cy', <string><unknown>p.y);
          point.style.strokeWidth = <string><unknown>scaleModifier;
          return point;
        } else {
          point.setAttribute('x', <string><unknown>(p.x - (instance.settings.pointSize / 2 * scaleModifier)));
          point.setAttribute('y', <string><unknown>(p.y - (instance.settings.pointSize / 2 * scaleModifier)));
          point.setAttribute('width', <string><unknown>(instance.settings.pointSize * scaleModifier));
          point.setAttribute('height', <string><unknown>(instance.settings.pointSize * scaleModifier));
          point.style.strokeWidth = <string><unknown>scaleModifier;
          return point;
        }
      }

      /* Handle rendering of a polygon */
      function generatePolygon(index:number, poly:PolyDecoration){
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('data-shape-index', <string><unknown>index);
        if (index === instance.currentDecoration) {
          group.classList.add('active');
        }
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.classList.add('image-interact-shape');
        polygon.setAttribute('data-shape-index', <string><unknown>index);
        polygon.setAttribute('points', poly.data.map(function(p:Point){
          return p.x + "," + p.y;
        }).join(","));
        polygon.style.strokeWidth = <string><unknown>scaleModifier;
        group.appendChild(polygon);
        if (instance.predictedPoint !== null) {
          const point = generateHandle(instance.predictedPoint, [], scaleModifier * 2);
          point.classList.add('ghost');
          group.appendChild(point);
        }
        for (let j = 0; j < poly.data.length; j++) {
          let extraclass = [];
          if (instance.pointIndex !== undefined) {
            if (instance.pointIndex === j) {
              extraclass.push('active');
            } else {
              extraclass.push('inactive');
            }
          }
          const point = generateHandle(poly.data[j], extraclass, scaleModifier);

          point.setAttribute('data-shape-index', <string><unknown>index);
          point.setAttribute('data-point-index', <string><unknown>j);
          group.appendChild(point);
        }
        return group;
      }

      for (let i = 0; i < this.decorations.length; i++) {
        if (this.decorations[i] !== undefined) {
          if(this.decorations[i].type == "poly") {
            const poly = generatePolygon(i, <PolyDecoration>this.decorations[i]);
            instance.svg.appendChild(poly);
          }
        }
      }
    }

    scalePoint(p:Point):void{
      if(this.panzoom !== undefined){
        let scale = this.panzoom.getTransform().scale;
        p.x /= scale;
        p.y /= scale;
      }
    }

    movePoly(poly:PolyDecoration, x:number, y:number):void{
      for (let i = 0; i < poly.data.length; i++) {
        poly.data[i].x += x;
        poly.data[i].y += y;
      }
    }

    switchMode(m:Mode){
      if(this.mode !== undefined) {
        this.wrapper.classList.remove(`${this.mode}-mode`);
      }
      this.mode = m;
      this.wrapper.classList.add(`${this.mode}-mode`);
    }
  }
})();
