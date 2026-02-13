/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise, SuppressedError, Symbol, Iterator */


function __decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const t$2=globalThis,e$2=t$2.ShadowRoot&&(void 0===t$2.ShadyCSS||t$2.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,s$2=Symbol(),o$4=new WeakMap;let n$3 = class n{constructor(t,e,o){if(this._$cssResult$=true,o!==s$2)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=t,this.t=e;}get styleSheet(){let t=this.o;const s=this.t;if(e$2&&void 0===t){const e=void 0!==s&&1===s.length;e&&(t=o$4.get(s)),void 0===t&&((this.o=t=new CSSStyleSheet).replaceSync(this.cssText),e&&o$4.set(s,t));}return t}toString(){return this.cssText}};const r$3=t=>new n$3("string"==typeof t?t:t+"",void 0,s$2),i$3=(t,...e)=>{const o=1===t.length?t[0]:e.reduce((e,s,o)=>e+(t=>{if(true===t._$cssResult$)return t.cssText;if("number"==typeof t)return t;throw Error("Value passed to 'css' function must be a 'css' function result: "+t+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(s)+t[o+1],t[0]);return new n$3(o,t,s$2)},S$1=(s,o)=>{if(e$2)s.adoptedStyleSheets=o.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(const e of o){const o=document.createElement("style"),n=t$2.litNonce;void 0!==n&&o.setAttribute("nonce",n),o.textContent=e.cssText,s.appendChild(o);}},c$2=e$2?t=>t:t=>t instanceof CSSStyleSheet?(t=>{let e="";for(const s of t.cssRules)e+=s.cssText;return r$3(e)})(t):t;

/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const{is:i$2,defineProperty:e$1,getOwnPropertyDescriptor:h$1,getOwnPropertyNames:r$2,getOwnPropertySymbols:o$3,getPrototypeOf:n$2}=Object,a$1=globalThis,c$1=a$1.trustedTypes,l$1=c$1?c$1.emptyScript:"",p$1=a$1.reactiveElementPolyfillSupport,d$1=(t,s)=>t,u$1={toAttribute(t,s){switch(s){case Boolean:t=t?l$1:null;break;case Object:case Array:t=null==t?t:JSON.stringify(t);}return t},fromAttribute(t,s){let i=t;switch(s){case Boolean:i=null!==t;break;case Number:i=null===t?null:Number(t);break;case Object:case Array:try{i=JSON.parse(t);}catch(t){i=null;}}return i}},f$1=(t,s)=>!i$2(t,s),b$1={attribute:true,type:String,converter:u$1,reflect:false,useDefault:false,hasChanged:f$1};Symbol.metadata??=Symbol("metadata"),a$1.litPropertyMetadata??=new WeakMap;let y$1 = class y extends HTMLElement{static addInitializer(t){this._$Ei(),(this.l??=[]).push(t);}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(t,s=b$1){if(s.state&&(s.attribute=false),this._$Ei(),this.prototype.hasOwnProperty(t)&&((s=Object.create(s)).wrapped=true),this.elementProperties.set(t,s),!s.noAccessor){const i=Symbol(),h=this.getPropertyDescriptor(t,i,s);void 0!==h&&e$1(this.prototype,t,h);}}static getPropertyDescriptor(t,s,i){const{get:e,set:r}=h$1(this.prototype,t)??{get(){return this[s]},set(t){this[s]=t;}};return {get:e,set(s){const h=e?.call(this);r?.call(this,s),this.requestUpdate(t,h,i);},configurable:true,enumerable:true}}static getPropertyOptions(t){return this.elementProperties.get(t)??b$1}static _$Ei(){if(this.hasOwnProperty(d$1("elementProperties")))return;const t=n$2(this);t.finalize(),void 0!==t.l&&(this.l=[...t.l]),this.elementProperties=new Map(t.elementProperties);}static finalize(){if(this.hasOwnProperty(d$1("finalized")))return;if(this.finalized=true,this._$Ei(),this.hasOwnProperty(d$1("properties"))){const t=this.properties,s=[...r$2(t),...o$3(t)];for(const i of s)this.createProperty(i,t[i]);}const t=this[Symbol.metadata];if(null!==t){const s=litPropertyMetadata.get(t);if(void 0!==s)for(const[t,i]of s)this.elementProperties.set(t,i);}this._$Eh=new Map;for(const[t,s]of this.elementProperties){const i=this._$Eu(t,s);void 0!==i&&this._$Eh.set(i,t);}this.elementStyles=this.finalizeStyles(this.styles);}static finalizeStyles(s){const i=[];if(Array.isArray(s)){const e=new Set(s.flat(1/0).reverse());for(const s of e)i.unshift(c$2(s));}else void 0!==s&&i.push(c$2(s));return i}static _$Eu(t,s){const i=s.attribute;return  false===i?void 0:"string"==typeof i?i:"string"==typeof t?t.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=false,this.hasUpdated=false,this._$Em=null,this._$Ev();}_$Ev(){this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(t=>t(this));}addController(t){(this._$EO??=new Set).add(t),void 0!==this.renderRoot&&this.isConnected&&t.hostConnected?.();}removeController(t){this._$EO?.delete(t);}_$E_(){const t=new Map,s=this.constructor.elementProperties;for(const i of s.keys())this.hasOwnProperty(i)&&(t.set(i,this[i]),delete this[i]);t.size>0&&(this._$Ep=t);}createRenderRoot(){const t=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return S$1(t,this.constructor.elementStyles),t}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(true),this._$EO?.forEach(t=>t.hostConnected?.());}enableUpdating(t){}disconnectedCallback(){this._$EO?.forEach(t=>t.hostDisconnected?.());}attributeChangedCallback(t,s,i){this._$AK(t,i);}_$ET(t,s){const i=this.constructor.elementProperties.get(t),e=this.constructor._$Eu(t,i);if(void 0!==e&&true===i.reflect){const h=(void 0!==i.converter?.toAttribute?i.converter:u$1).toAttribute(s,i.type);this._$Em=t,null==h?this.removeAttribute(e):this.setAttribute(e,h),this._$Em=null;}}_$AK(t,s){const i=this.constructor,e=i._$Eh.get(t);if(void 0!==e&&this._$Em!==e){const t=i.getPropertyOptions(e),h="function"==typeof t.converter?{fromAttribute:t.converter}:void 0!==t.converter?.fromAttribute?t.converter:u$1;this._$Em=e;const r=h.fromAttribute(s,t.type);this[e]=r??this._$Ej?.get(e)??r,this._$Em=null;}}requestUpdate(t,s,i,e=false,h){if(void 0!==t){const r=this.constructor;if(false===e&&(h=this[t]),i??=r.getPropertyOptions(t),!((i.hasChanged??f$1)(h,s)||i.useDefault&&i.reflect&&h===this._$Ej?.get(t)&&!this.hasAttribute(r._$Eu(t,i))))return;this.C(t,s,i);} false===this.isUpdatePending&&(this._$ES=this._$EP());}C(t,s,{useDefault:i,reflect:e,wrapped:h},r){i&&!(this._$Ej??=new Map).has(t)&&(this._$Ej.set(t,r??s??this[t]),true!==h||void 0!==r)||(this._$AL.has(t)||(this.hasUpdated||i||(s=void 0),this._$AL.set(t,s)),true===e&&this._$Em!==t&&(this._$Eq??=new Set).add(t));}async _$EP(){this.isUpdatePending=true;try{await this._$ES;}catch(t){Promise.reject(t);}const t=this.scheduleUpdate();return null!=t&&await t,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(const[t,s]of this._$Ep)this[t]=s;this._$Ep=void 0;}const t=this.constructor.elementProperties;if(t.size>0)for(const[s,i]of t){const{wrapped:t}=i,e=this[s];true!==t||this._$AL.has(s)||void 0===e||this.C(s,void 0,i,e);}}let t=false;const s=this._$AL;try{t=this.shouldUpdate(s),t?(this.willUpdate(s),this._$EO?.forEach(t=>t.hostUpdate?.()),this.update(s)):this._$EM();}catch(s){throw t=false,this._$EM(),s}t&&this._$AE(s);}willUpdate(t){}_$AE(t){this._$EO?.forEach(t=>t.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=true,this.firstUpdated(t)),this.updated(t);}_$EM(){this._$AL=new Map,this.isUpdatePending=false;}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(t){return  true}update(t){this._$Eq&&=this._$Eq.forEach(t=>this._$ET(t,this[t])),this._$EM();}updated(t){}firstUpdated(t){}};y$1.elementStyles=[],y$1.shadowRootOptions={mode:"open"},y$1[d$1("elementProperties")]=new Map,y$1[d$1("finalized")]=new Map,p$1?.({ReactiveElement:y$1}),(a$1.reactiveElementVersions??=[]).push("2.1.2");

/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const t$1=globalThis,i$1=t=>t,s$1=t$1.trustedTypes,e=s$1?s$1.createPolicy("lit-html",{createHTML:t=>t}):void 0,h="$lit$",o$2=`lit$${Math.random().toFixed(9).slice(2)}$`,n$1="?"+o$2,r$1=`<${n$1}>`,l=document,c=()=>l.createComment(""),a=t=>null===t||"object"!=typeof t&&"function"!=typeof t,u=Array.isArray,d=t=>u(t)||"function"==typeof t?.[Symbol.iterator],f="[ \t\n\f\r]",v=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,_=/-->/g,m=/>/g,p=RegExp(`>|${f}(?:([^\\s"'>=/]+)(${f}*=${f}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`,"g"),g=/'/g,$=/"/g,y=/^(?:script|style|textarea|title)$/i,x=t=>(i,...s)=>({_$litType$:t,strings:i,values:s}),b=x(1),E=Symbol.for("lit-noChange"),A=Symbol.for("lit-nothing"),C=new WeakMap,P=l.createTreeWalker(l,129);function V(t,i){if(!u(t)||!t.hasOwnProperty("raw"))throw Error("invalid template strings array");return void 0!==e?e.createHTML(i):i}const N=(t,i)=>{const s=t.length-1,e=[];let n,l=2===i?"<svg>":3===i?"<math>":"",c=v;for(let i=0;i<s;i++){const s=t[i];let a,u,d=-1,f=0;for(;f<s.length&&(c.lastIndex=f,u=c.exec(s),null!==u);)f=c.lastIndex,c===v?"!--"===u[1]?c=_:void 0!==u[1]?c=m:void 0!==u[2]?(y.test(u[2])&&(n=RegExp("</"+u[2],"g")),c=p):void 0!==u[3]&&(c=p):c===p?">"===u[0]?(c=n??v,d=-1):void 0===u[1]?d=-2:(d=c.lastIndex-u[2].length,a=u[1],c=void 0===u[3]?p:'"'===u[3]?$:g):c===$||c===g?c=p:c===_||c===m?c=v:(c=p,n=void 0);const x=c===p&&t[i+1].startsWith("/>")?" ":"";l+=c===v?s+r$1:d>=0?(e.push(a),s.slice(0,d)+h+s.slice(d)+o$2+x):s+o$2+(-2===d?i:x);}return [V(t,l+(t[s]||"<?>")+(2===i?"</svg>":3===i?"</math>":"")),e]};class S{constructor({strings:t,_$litType$:i},e){let r;this.parts=[];let l=0,a=0;const u=t.length-1,d=this.parts,[f,v]=N(t,i);if(this.el=S.createElement(f,e),P.currentNode=this.el.content,2===i||3===i){const t=this.el.content.firstChild;t.replaceWith(...t.childNodes);}for(;null!==(r=P.nextNode())&&d.length<u;){if(1===r.nodeType){if(r.hasAttributes())for(const t of r.getAttributeNames())if(t.endsWith(h)){const i=v[a++],s=r.getAttribute(t).split(o$2),e=/([.?@])?(.*)/.exec(i);d.push({type:1,index:l,name:e[2],strings:s,ctor:"."===e[1]?I:"?"===e[1]?L:"@"===e[1]?z:H}),r.removeAttribute(t);}else t.startsWith(o$2)&&(d.push({type:6,index:l}),r.removeAttribute(t));if(y.test(r.tagName)){const t=r.textContent.split(o$2),i=t.length-1;if(i>0){r.textContent=s$1?s$1.emptyScript:"";for(let s=0;s<i;s++)r.append(t[s],c()),P.nextNode(),d.push({type:2,index:++l});r.append(t[i],c());}}}else if(8===r.nodeType)if(r.data===n$1)d.push({type:2,index:l});else {let t=-1;for(;-1!==(t=r.data.indexOf(o$2,t+1));)d.push({type:7,index:l}),t+=o$2.length-1;}l++;}}static createElement(t,i){const s=l.createElement("template");return s.innerHTML=t,s}}function M(t,i,s=t,e){if(i===E)return i;let h=void 0!==e?s._$Co?.[e]:s._$Cl;const o=a(i)?void 0:i._$litDirective$;return h?.constructor!==o&&(h?._$AO?.(false),void 0===o?h=void 0:(h=new o(t),h._$AT(t,s,e)),void 0!==e?(s._$Co??=[])[e]=h:s._$Cl=h),void 0!==h&&(i=M(t,h._$AS(t,i.values),h,e)),i}class R{constructor(t,i){this._$AV=[],this._$AN=void 0,this._$AD=t,this._$AM=i;}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(t){const{el:{content:i},parts:s}=this._$AD,e=(t?.creationScope??l).importNode(i,true);P.currentNode=e;let h=P.nextNode(),o=0,n=0,r=s[0];for(;void 0!==r;){if(o===r.index){let i;2===r.type?i=new k(h,h.nextSibling,this,t):1===r.type?i=new r.ctor(h,r.name,r.strings,this,t):6===r.type&&(i=new Z(h,this,t)),this._$AV.push(i),r=s[++n];}o!==r?.index&&(h=P.nextNode(),o++);}return P.currentNode=l,e}p(t){let i=0;for(const s of this._$AV) void 0!==s&&(void 0!==s.strings?(s._$AI(t,s,i),i+=s.strings.length-2):s._$AI(t[i])),i++;}}class k{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(t,i,s,e){this.type=2,this._$AH=A,this._$AN=void 0,this._$AA=t,this._$AB=i,this._$AM=s,this.options=e,this._$Cv=e?.isConnected??true;}get parentNode(){let t=this._$AA.parentNode;const i=this._$AM;return void 0!==i&&11===t?.nodeType&&(t=i.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,i=this){t=M(this,t,i),a(t)?t===A||null==t||""===t?(this._$AH!==A&&this._$AR(),this._$AH=A):t!==this._$AH&&t!==E&&this._(t):void 0!==t._$litType$?this.$(t):void 0!==t.nodeType?this.T(t):d(t)?this.k(t):this._(t);}O(t){return this._$AA.parentNode.insertBefore(t,this._$AB)}T(t){this._$AH!==t&&(this._$AR(),this._$AH=this.O(t));}_(t){this._$AH!==A&&a(this._$AH)?this._$AA.nextSibling.data=t:this.T(l.createTextNode(t)),this._$AH=t;}$(t){const{values:i,_$litType$:s}=t,e="number"==typeof s?this._$AC(t):(void 0===s.el&&(s.el=S.createElement(V(s.h,s.h[0]),this.options)),s);if(this._$AH?._$AD===e)this._$AH.p(i);else {const t=new R(e,this),s=t.u(this.options);t.p(i),this.T(s),this._$AH=t;}}_$AC(t){let i=C.get(t.strings);return void 0===i&&C.set(t.strings,i=new S(t)),i}k(t){u(this._$AH)||(this._$AH=[],this._$AR());const i=this._$AH;let s,e=0;for(const h of t)e===i.length?i.push(s=new k(this.O(c()),this.O(c()),this,this.options)):s=i[e],s._$AI(h),e++;e<i.length&&(this._$AR(s&&s._$AB.nextSibling,e),i.length=e);}_$AR(t=this._$AA.nextSibling,s){for(this._$AP?.(false,true,s);t!==this._$AB;){const s=i$1(t).nextSibling;i$1(t).remove(),t=s;}}setConnected(t){ void 0===this._$AM&&(this._$Cv=t,this._$AP?.(t));}}class H{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(t,i,s,e,h){this.type=1,this._$AH=A,this._$AN=void 0,this.element=t,this.name=i,this._$AM=e,this.options=h,s.length>2||""!==s[0]||""!==s[1]?(this._$AH=Array(s.length-1).fill(new String),this.strings=s):this._$AH=A;}_$AI(t,i=this,s,e){const h=this.strings;let o=false;if(void 0===h)t=M(this,t,i,0),o=!a(t)||t!==this._$AH&&t!==E,o&&(this._$AH=t);else {const e=t;let n,r;for(t=h[0],n=0;n<h.length-1;n++)r=M(this,e[s+n],i,n),r===E&&(r=this._$AH[n]),o||=!a(r)||r!==this._$AH[n],r===A?t=A:t!==A&&(t+=(r??"")+h[n+1]),this._$AH[n]=r;}o&&!e&&this.j(t);}j(t){t===A?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,t??"");}}class I extends H{constructor(){super(...arguments),this.type=3;}j(t){this.element[this.name]=t===A?void 0:t;}}class L extends H{constructor(){super(...arguments),this.type=4;}j(t){this.element.toggleAttribute(this.name,!!t&&t!==A);}}class z extends H{constructor(t,i,s,e,h){super(t,i,s,e,h),this.type=5;}_$AI(t,i=this){if((t=M(this,t,i,0)??A)===E)return;const s=this._$AH,e=t===A&&s!==A||t.capture!==s.capture||t.once!==s.once||t.passive!==s.passive,h=t!==A&&(s===A||e);e&&this.element.removeEventListener(this.name,this,s),h&&this.element.addEventListener(this.name,this,t),this._$AH=t;}handleEvent(t){"function"==typeof this._$AH?this._$AH.call(this.options?.host??this.element,t):this._$AH.handleEvent(t);}}class Z{constructor(t,i,s){this.element=t,this.type=6,this._$AN=void 0,this._$AM=i,this.options=s;}get _$AU(){return this._$AM._$AU}_$AI(t){M(this,t);}}const B=t$1.litHtmlPolyfillSupport;B?.(S,k),(t$1.litHtmlVersions??=[]).push("3.3.2");const D=(t,i,s)=>{const e=s?.renderBefore??i;let h=e._$litPart$;if(void 0===h){const t=s?.renderBefore??null;e._$litPart$=h=new k(i.insertBefore(c(),t),t,void 0,s??{});}return h._$AI(t),h};

/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const s=globalThis;class i extends y$1{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0;}createRenderRoot(){const t=super.createRenderRoot();return this.renderOptions.renderBefore??=t.firstChild,t}update(t){const r=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(t),this._$Do=D(r,this.renderRoot,this.renderOptions);}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(true);}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(false);}render(){return E}}i._$litElement$=true,i["finalized"]=true,s.litElementHydrateSupport?.({LitElement:i});const o$1=s.litElementPolyfillSupport;o$1?.({LitElement:i});(s.litElementVersions??=[]).push("4.2.2");

/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const t=t=>(e,o)=>{ void 0!==o?o.addInitializer(()=>{customElements.define(t,e);}):customElements.define(t,e);};

/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const o={attribute:true,type:String,converter:u$1,reflect:false,hasChanged:f$1},r=(t=o,e,r)=>{const{kind:n,metadata:i}=r;let s=globalThis.litPropertyMetadata.get(i);if(void 0===s&&globalThis.litPropertyMetadata.set(i,s=new Map),"setter"===n&&((t=Object.create(t)).wrapped=true),s.set(r.name,t),"accessor"===n){const{name:o}=r;return {set(r){const n=e.get.call(this);e.set.call(this,r),this.requestUpdate(o,n,t,true,r);},init(e){return void 0!==e&&this.C(o,void 0,t,e),e}}}if("setter"===n){const{name:o}=r;return function(r){const n=this[o];e.call(this,r),this.requestUpdate(o,n,t,true,r);}}throw Error("Unsupported decorator location: "+n)};function n(t){return (e,o)=>"object"==typeof o?r(t,e,o):((t,e,o)=>{const r=e.hasOwnProperty(o);return e.constructor.createProperty(o,t),r?Object.getOwnPropertyDescriptor(e,o):void 0})(t,e,o)}

// Climate Entity Feature Enum (matching Home Assistant)
const ClimateEntityFeature = {
    TARGET_TEMPERATURE: 1,
    TARGET_TEMPERATURE_RANGE: 2,
    TARGET_HUMIDITY: 4,
    FAN_MODE: 8,
    PRESET_MODE: 16,
    SWING_MODE: 32,
    AUX_HEAT: 64,
    TURN_OFF: 128,
    TURN_ON: 256,
    SWING_HORIZONTAL_MODE: 512,
};
// Helper function to check if a feature is supported
function supportsFeature(stateObj, feature) {
    return (stateObj.attributes.supported_features & feature) !== 0;
}
let ClimateControlDialog = class ClimateControlDialog extends i {
    constructor() {
        super(...arguments);
        this.stateObj = null;
    }
    // Helper to capitalize mode text
    _capitalize(text) {
        // Special case for heat_cool
        if (text === 'heat_cool') {
            return 'Heat/Cool';
        }
        return text.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }
    render() {
        if (!this.stateObj) {
            return b `<div>No climate entity data</div>`;
        }
        return b `
      ${this._renderModeRow()}
      ${this._renderTargetTemperature()}
      ${this._renderTargetTemperatureRange()}
      ${this._renderTargetHumidity()}
      ${this._renderFanSwingRow()}
      ${this._renderAuxHeat()}
    `;
    }
    _renderModeRow() {
        const hasPresetMode = supportsFeature(this.stateObj, ClimateEntityFeature.PRESET_MODE);
        if (!hasPresetMode) {
            return this._renderHvacModes();
        }
        return b `
      <div class="mode-row">
        ${this._renderHvacModes()}
        ${this._renderPresetModes()}
      </div>
    `;
    }
    _renderHvacModes() {
        if (!this.stateObj)
            return '';
        return b `
      <div class="section">
        <div class="section-title">HVAC Mode</div>
        <select 
          class="mode-select"
          .value=${this.stateObj.state}
          @change=${this._handleHvacModeChange}
        >
          ${this.stateObj.attributes.hvac_modes.map(mode => b `
            <option value="${mode}" ?selected=${this.stateObj.state === mode}>
              ${this._capitalize(mode)}
            </option>
          `)}
        </select>
      </div>
    `;
    }
    _renderTargetTemperature() {
        if (!this.stateObj || !supportsFeature(this.stateObj, ClimateEntityFeature.TARGET_TEMPERATURE)) {
            return '';
        }
        const { min_temp, max_temp, temperature } = this.stateObj.attributes;
        const range = max_temp - min_temp;
        const tempPercent = ((temperature - min_temp) / range) * 100;
        // Use the currently selected HVAC mode to determine styling
        const currentMode = this.stateObj.state;
        // Determine class, track fill, and label based on current mode
        let inputClass = '';
        let trackFill = tempPercent;
        let label = 'Set to';
        if (currentMode === 'heat_cool') {
            inputClass = 'heat-cool';
        }
        else if (currentMode === 'cool') {
            inputClass = 'cooling';
            trackFill = 100 - tempPercent;
            label = 'Cool to';
        }
        else if (currentMode === 'heat') {
            inputClass = 'heating';
            label = 'Heat to';
        }
        return b `
      <div class="section">
        <div class="section-title">Target Temperature</div>
        <div class="temp-range-control">
          <div class="temp-range-labels" style="justify-content: center;">
            <div class="temp-range-value">
              <span class="temp-range-label">${label}</span>
              <span class="temp-range-number">${temperature}°</span>
            </div>
          </div>
          <div class="dual-range-container">
            <input 
              type="range" 
              class="dual-range-input ${inputClass}"
              min="${min_temp}"
              max="${max_temp}"
              step="0.5"
              .value="${temperature}"
              @input=${this._handleTempSlider}
              style="top: 0; --track-fill: ${trackFill}%;"
            />
          </div>
        </div>
      </div>
    `;
    }
    _renderTargetTemperatureRange() {
        if (!this.stateObj || !supportsFeature(this.stateObj, ClimateEntityFeature.TARGET_TEMPERATURE_RANGE)) {
            return '';
        }
        const { min_temp, max_temp, target_temp_low, target_temp_high } = this.stateObj.attributes;
        const range = max_temp - min_temp;
        const lowPercent = ((target_temp_low - min_temp) / range) * 100;
        const highPercent = ((target_temp_high - min_temp) / range) * 100;
        // Use the currently selected HVAC mode to determine layout
        const currentMode = this.stateObj.state;
        // Determine if we need dual range or single based on current mode
        const heatOnly = currentMode === 'heat';
        const coolOnly = currentMode === 'cool';
        const isOffOrAuto = currentMode === 'off' || currentMode === 'auto';
        // Render heat only (single input with red track)
        if (heatOnly) {
            return b `
        <div class="section">
          <div class="section-title">Target Temperature</div>
          <div class="temp-range-control">
            <div class="temp-range-labels" style="justify-content: center;">
              <div class="temp-range-value">
                <span class="temp-range-label">Heat to</span>
                <span class="temp-range-number">${target_temp_low}°</span>
              </div>
            </div>
            <div class="dual-range-container">
              <input 
                type="range" 
                class="dual-range-input heating"
                min="${min_temp}"
                max="${max_temp}"
                step="0.5"
                .value="${target_temp_low}"
                @input=${this._handleTempLowSlider}
                style="top: 0; --track-fill: ${lowPercent}%;"
              />
            </div>
          </div>
        </div>
      `;
        }
        // Render cool only (single input with blue track)
        if (coolOnly) {
            return b `
        <div class="section">
          <div class="section-title">Target Temperature</div>
          <div class="temp-range-control">
            <div class="temp-range-labels" style="justify-content: center;">
              <div class="temp-range-value">
                <span class="temp-range-label">Cool to</span>
                <span class="temp-range-number">${target_temp_high}°</span>
              </div>
            </div>
            <div class="dual-range-container">
              <input 
                type="range" 
                class="dual-range-input cooling"
                min="${min_temp}"
                max="${max_temp}"
                step="0.5"
                .value="${target_temp_high}"
                @input=${this._handleTempHighSlider}
                style="top: 0; --track-fill: ${100 - highPercent}%;"
              />
            </div>
          </div>
        </div>
      `;
        }
        // Render dual range (both heat and cool, heat_cool, auto, or off)
        return b `
      <div class="section">
        <div class="section-title">Temperature Range</div>
        <div class="temp-range-control">
          <div class="temp-range-labels">
            <div class="temp-range-value">
              <span class="temp-range-label">Heat to</span>
              <span class="temp-range-number">${target_temp_low}°</span>
            </div>
            <div class="temp-range-value">
              <span class="temp-range-label">Cool to</span>
              <span class="temp-range-number">${target_temp_high}°</span>
            </div>
          </div>
          <div class="dual-range-container">
            ${!isOffOrAuto ? b `
              <div class="dual-range-fill" 
                style="left: ${lowPercent}%; width: ${highPercent - lowPercent}%">
              </div>
            ` : ''}
            <input 
              type="range" 
              class="dual-range-input ${!isOffOrAuto ? 'heating' : ''}"
              min="${min_temp}"
              max="${max_temp}"
              step="0.5"
              .value="${target_temp_low}"
              @input=${this._handleTempLowSlider}
              style="top: 0; --track-fill: ${lowPercent}%;"
            />
            <input 
              type="range" 
              class="dual-range-input ${!isOffOrAuto ? 'cooling' : ''}"
              min="${min_temp}"
              max="${max_temp}"
              step="0.5"
              .value="${target_temp_high}"
              @input=${this._handleTempHighSlider}
              style="top: 0; --track-fill: ${100 - highPercent}%;"
            />
          </div>
        </div>
      </div>
    `;
    }
    _renderTargetHumidity() {
        if (!this.stateObj || !supportsFeature(this.stateObj, ClimateEntityFeature.TARGET_HUMIDITY)) {
            return '';
        }
        const { min_humidity, max_humidity, target_humidity } = this.stateObj.attributes;
        const range = max_humidity - min_humidity;
        const humidityPercent = ((target_humidity - min_humidity) / range) * 100;
        return b `
      <div class="section">
        <div class="section-title">Target Humidity</div>
        <div class="temp-range-control">
          <div class="temp-range-labels" style="justify-content: center;">
            <div class="temp-range-value">
              <span class="temp-range-label">Set to</span>
              <span class="temp-range-number">${target_humidity}%</span>
            </div>
          </div>
          <div class="dual-range-container">
            <input 
              type="range" 
              class="dual-range-input"
              min="${min_humidity}"
              max="${max_humidity}"
              step="1"
              .value="${target_humidity}"
              @input=${this._handleHumiditySlider}
              style="top: 0; --track-fill: ${humidityPercent}%;"
            />
          </div>
        </div>
      </div>
    `;
    }
    _renderFanSwingRow() {
        const hasFanMode = supportsFeature(this.stateObj, ClimateEntityFeature.FAN_MODE);
        const hasSwingMode = supportsFeature(this.stateObj, ClimateEntityFeature.SWING_MODE);
        const hasSwingHorizontal = supportsFeature(this.stateObj, ClimateEntityFeature.SWING_HORIZONTAL_MODE);
        // If none are present, return nothing
        if (!hasFanMode && !hasSwingMode && !hasSwingHorizontal) {
            return '';
        }
        // If only one is present, show it full width
        if (hasFanMode && !hasSwingMode && !hasSwingHorizontal) {
            return this._renderFanModes();
        }
        if (!hasFanMode && hasSwingMode && !hasSwingHorizontal) {
            return this._renderSwingModes();
        }
        if (!hasFanMode && !hasSwingMode && hasSwingHorizontal) {
            return this._renderSwingHorizontalModes();
        }
        // Show all present modes in a row
        return b `
      <div class="mode-row">
        ${hasFanMode ? this._renderFanModes() : ''}
        ${hasSwingMode ? this._renderSwingModes() : ''}
        ${hasSwingHorizontal ? this._renderSwingHorizontalModes() : ''}
      </div>
    `;
    }
    _renderFanModes() {
        if (!this.stateObj)
            return '';
        return b `
      <div class="section">
        <div class="section-title">Fan Mode</div>
        <select 
          class="mode-select"
          .value=${this.stateObj.attributes.fan_mode || ''}
          @change=${this._handleFanModeChange}
        >
          ${this.stateObj.attributes.fan_modes.map(mode => b `
            <option value="${mode}" ?selected=${this.stateObj.attributes.fan_mode === mode}>
              ${this._capitalize(mode)}
            </option>
          `)}
        </select>
      </div>
    `;
    }
    _renderPresetModes() {
        if (!this.stateObj)
            return '';
        return b `
      <div class="section">
        <div class="section-title">Thermostat Preset</div>
        <select 
          class="mode-select"
          .value=${this.stateObj.attributes.preset_mode || ''}
          @change=${this._handlePresetModeChange}
        >
          ${this.stateObj.attributes.preset_modes.map(mode => b `
            <option value="${mode}" ?selected=${this.stateObj.attributes.preset_mode === mode}>
              ${this._capitalize(mode)}
            </option>
          `)}
        </select>
      </div>
    `;
    }
    _renderSwingModes() {
        if (!this.stateObj)
            return '';
        return b `
      <div class="section">
        <div class="section-title">Swing (Vertical)</div>
        <select 
          class="mode-select"
          .value=${this.stateObj.attributes.swing_mode || ''}
          @change=${this._handleSwingModeChange}
        >
          ${this.stateObj.attributes.swing_modes.map(mode => b `
            <option value="${mode}" ?selected=${this.stateObj.attributes.swing_mode === mode}>
              ${this._capitalize(mode)}
            </option>
          `)}
        </select>
      </div>
    `;
    }
    _renderSwingHorizontalModes() {
        if (!this.stateObj)
            return '';
        return b `
      <div class="section">
        <div class="section-title">Swing (Horizontal)</div>
        <select 
          class="mode-select"
          .value=${this.stateObj.attributes.swing_horizontal_mode || ''}
          @change=${this._handleSwingHorizontalModeChange}
        >
          ${this.stateObj.attributes.swing_horizontal_modes.map(mode => b `
            <option value="${mode}" ?selected=${this.stateObj.attributes.swing_horizontal_mode === mode}>
              ${this._capitalize(mode)}
            </option>
          `)}
        </select>
      </div>
    `;
    }
    _renderAuxHeat() {
        if (!this.stateObj || !supportsFeature(this.stateObj, ClimateEntityFeature.AUX_HEAT)) {
            return '';
        }
        return b `
      <div class="section">
        <div class="section-title">Auxiliary Heat</div>
        <div class="toggle-row">
          <span class="toggle-label">Aux Heat</span>
          <label class="toggle-switch">
            <input 
              type="checkbox" 
              .checked=${this.stateObj.attributes.aux_heat === 'on'}
              @change=${this._handleAuxHeatToggle}
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    `;
    }
    // Event handlers that dispatch custom events for parent to handle
    _handleHvacModeChange(e) {
        const value = e.target.value;
        this.dispatchEvent(new CustomEvent('hvac-mode-changed', {
            detail: { mode: value },
            bubbles: true,
            composed: true
        }));
    }
    _handleTempSlider(e) {
        const value = parseFloat(e.target.value);
        // Update stateObj to trigger re-render with new track fill
        if (this.stateObj) {
            this.stateObj = {
                ...this.stateObj,
                attributes: {
                    ...this.stateObj.attributes,
                    temperature: value
                }
            };
        }
        this.dispatchEvent(new CustomEvent('temperature-changed', {
            detail: { temperature: value },
            bubbles: true,
            composed: true
        }));
    }
    _handleTempLowSlider(e) {
        const value = parseFloat(e.target.value);
        // Update stateObj to trigger re-render with new track fill
        if (this.stateObj) {
            this.stateObj = {
                ...this.stateObj,
                attributes: {
                    ...this.stateObj.attributes,
                    target_temp_low: value
                }
            };
        }
        this.dispatchEvent(new CustomEvent('target-temp-low-changed', {
            detail: { temperature: value },
            bubbles: true,
            composed: true
        }));
    }
    _handleTempHighSlider(e) {
        const value = parseFloat(e.target.value);
        // Update stateObj to trigger re-render with new track fill
        if (this.stateObj) {
            this.stateObj = {
                ...this.stateObj,
                attributes: {
                    ...this.stateObj.attributes,
                    target_temp_high: value
                }
            };
        }
        this.dispatchEvent(new CustomEvent('target-temp-high-changed', {
            detail: { temperature: value },
            bubbles: true,
            composed: true
        }));
    }
    _handleHumiditySlider(e) {
        const value = parseFloat(e.target.value);
        // Update stateObj to trigger re-render with new track fill
        if (this.stateObj) {
            this.stateObj = {
                ...this.stateObj,
                attributes: {
                    ...this.stateObj.attributes,
                    target_humidity: value
                }
            };
        }
        this.dispatchEvent(new CustomEvent('humidity-changed', {
            detail: { humidity: value },
            bubbles: true,
            composed: true
        }));
    }
    _handleFanModeChange(e) {
        const value = e.target.value;
        this.dispatchEvent(new CustomEvent('fan-mode-changed', {
            detail: { mode: value },
            bubbles: true,
            composed: true
        }));
    }
    _handlePresetModeChange(e) {
        const value = e.target.value;
        this.dispatchEvent(new CustomEvent('preset-mode-changed', {
            detail: { mode: value },
            bubbles: true,
            composed: true
        }));
    }
    _handleSwingModeChange(e) {
        const value = e.target.value;
        this.dispatchEvent(new CustomEvent('swing-mode-changed', {
            detail: { mode: value },
            bubbles: true,
            composed: true
        }));
    }
    _handleSwingHorizontalModeChange(e) {
        const value = e.target.value;
        this.dispatchEvent(new CustomEvent('swing-horizontal-mode-changed', {
            detail: { mode: value },
            bubbles: true,
            composed: true
        }));
    }
    _handleAuxHeatToggle(e) {
        const checked = e.target.checked;
        this.dispatchEvent(new CustomEvent('aux-heat-changed', {
            detail: { enabled: checked },
            bubbles: true,
            composed: true
        }));
    }
};
ClimateControlDialog.styles = i$3 `
    :host {
      display: block;
      background: transparent;
      border-radius: var(--ha-card-border-radius, 8px);
      padding: 0;
    }

    .dialog-header {
      font-size: 20px;
      font-weight: 500;
      color: var(--primary-text-color, #333);
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .entity-icon {
      font-size: 28px;
    }

    .section {
      margin-bottom: 20px;
    }

    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--secondary-text-color, #666);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .mode-row {
      display: flex;
      gap: 12px;
    }

    .mode-row .section {
      flex: 1;
    }

    .mode-select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 4px;
      background: var(--card-background-color, white);
      font-size: 14px;
      color: var(--primary-text-color, #333);
      cursor: pointer;
      outline: none;
      transition: border-color 0.2s;
    }

    .mode-select:hover {
      border-color: #999;
    }

    .mode-select:focus {
      border-color: var(--primary-color, #03a9f4);
      box-shadow: 0 0 0 2px rgba(3, 169, 244, 0.1);
    }

    .temp-range-control {
      position: relative;
    }

    .dual-range-container {
      position: relative;
      margin: 0 0;
      padding: 0;
    }

    .dual-range-input {
      position: absolute;
      width: 100%;
      left: 0;
      pointer-events: none;
      -webkit-appearance: none;
      background: transparent;
      margin: 0;
      height: 20px;
    }

    .dual-range-input::-webkit-slider-runnable-track {
      background: transparent;
      height: 8px;
      border-radius: 4px;
    }

    .dual-range-input::-webkit-slider-thumb {
      -webkit-appearance: none;
      pointer-events: all;
      width: 20px !important;
      height: 20px !important;
      border-radius: 10px;
      background: linear-gradient(to bottom, white, #f8f8f8);
      cursor: grab;
      border: 2px solid var(--primary-color, #03a9f4);
      box-shadow: 
        0 2px 8px rgba(0,0,0,0.15),
        inset 0 1px 0 rgba(255,255,255,0.8);
      margin-top: -6px !important;
      transition: transform 0.15s, box-shadow 0.15s;
    }

    .dual-range-input::-webkit-slider-thumb:hover {
      transform: scale(1.1);
      box-shadow: 
        0 4px 12px rgba(0,0,0,0.2),
        inset 0 1px 0 rgba(255,255,255,0.8);
    }

    .dual-range-input::-moz-range-track {
      background: transparent;
      height: 8px;
      border-radius: 4px;
    }

    .dual-range-input::-moz-range-thumb {
      border: none;
      width: 20px !important;
      height: 20px !important;
      border-radius: 10px;
      background: linear-gradient(to bottom, white, #f8f8f8);
      cursor: grab;
      border: 2px solid var(--primary-color, #03a9f4);
      box-shadow: 
        0 2px 8px rgba(0,0,0,0.15),
        inset 0 1px 0 rgba(255,255,255,0.8);
      margin-top: -6px !important;
      transition: transform 0.15s, box-shadow 0.15s;
    }

    .dual-range-input::-moz-range-thumb:hover {
      transform: scale(1.1);
      box-shadow: 
        0 4px 12px rgba(0,0,0,0.2),
        inset 0 1px 0 rgba(255,255,255,0.8);
    }

    .dual-range-input:focus::-webkit-slider-thumb {
      box-shadow: 
        0 0 0 4px rgba(3, 169, 244, 0.2),
        0 2px 8px rgba(0,0,0,0.15),
        inset 0 1px 0 rgba(255,255,255,0.8);
    }

    .dual-range-input:focus::-moz-range-thumb {
      box-shadow: 
        0 0 0 4px rgba(3, 169, 244, 0.2),
        0 2px 8px rgba(0,0,0,0.15),
        inset 0 1px 0 rgba(255,255,255,0.8);
    }

    /* Heating input - red from left to thumb */
    .dual-range-input.heating::-webkit-slider-runnable-track {
      background: linear-gradient(to right, 
        #f44336 0%, 
        #f44336 var(--track-fill, 50%), 
        transparent var(--track-fill, 50%));
      height: 8px;
      border-radius: 4px;
      position: relative;
      z-index: 5;
    }

    .dual-range-input.heating::-moz-range-track {
      background: transparent;
      height: 8px;
      border-radius: 4px;
    }

    .dual-range-input.heating::-moz-range-progress {
      background: #f44336;
      height: 8px;
      border-radius: 4px 0 0 4px;
    }

    /* Cooling input - blue from right to thumb */
    .dual-range-input.cooling::-webkit-slider-runnable-track {
      background: linear-gradient(to left, 
        #2196f3 0%, 
        #2196f3 var(--track-fill, 50%), 
        transparent var(--track-fill, 50%));
      height: 8px;
      border-radius: 4px;
      position: relative;
      z-index: 5;
    }

    .dual-range-input.cooling::-moz-range-track {
      background: transparent;
      height: 8px;
      border-radius: 4px;
    }

    .dual-range-input.cooling::-moz-range-progress {
      background: #2196f3;
      height: 8px;
      border-radius: 0 4px 4px 0;
      transform: scaleX(-1);
      transform-origin: center;
    }

    /* Heat/Cool input - orange full track */
    .dual-range-input.heat-cool::-webkit-slider-runnable-track {
      background: #ff9800;
      height: 8px;
      border-radius: 4px;
      position: relative;
      z-index: 5;
    }

    .dual-range-input.heat-cool::-moz-range-track {
      background: #ff9800;
      height: 8px;
      border-radius: 4px;
    }

    .temp-range-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 12px;
      padding: 0 10px;
    }

    .temp-range-value {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .temp-range-label {
      font-size: 11px;
      color: var(--secondary-text-color, #666);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .temp-range-number {
      font-size: 24px;
      font-weight: 600;
      color: var(--primary-text-color, #333);
    }

    .dual-range-fill {
      position: absolute;
      height: 8px;
      background: linear-gradient(90deg, rgba(244, 67, 54, 0.3), rgba(33, 150, 243, 0.3));
      border-radius: 4px;
      top: 50%;
      transform: translateY(-50%);
      pointer-events: none;
      z-index: 1;
    }

    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0;
    }

    .toggle-label {
      font-size: 14px;
      color: var(--primary-text-color, #333);
    }

    .toggle-switch {
      position: relative;
      display: inline-block;
      width: 48px;
      height: 26px;
    }

    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #ccc;
      transition: .4s;
      border-radius: 26px;
    }

    .toggle-slider:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 4px;
      bottom: 4px;
      background-color: white;
      transition: .4s;
      border-radius: 50%;
    }

    input:checked + .toggle-slider {
      background-color: var(--primary-color, #03a9f4);
    }

    input:checked + .toggle-slider:before {
      transform: translateX(22px);
    }
  `;
__decorate([
    n({ type: Object })
], ClimateControlDialog.prototype, "stateObj", void 0);
ClimateControlDialog = __decorate([
    t('climate-control-dialog')
], ClimateControlDialog);

export { ClimateControlDialog, ClimateEntityFeature, supportsFeature };
//# sourceMappingURL=climate-dialog.js.map
