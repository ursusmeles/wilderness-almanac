// Templates own structure; callers populate values and attach behaviour.
export function cloneTemplate(id) {
  return document.getElementById(id).content.cloneNode(true);
}
