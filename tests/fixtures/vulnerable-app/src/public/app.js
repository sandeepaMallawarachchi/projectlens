export function renderComment(container, comment) {
  container.innerHTML = comment.body;
}

export function saveSession(token) {
  localStorage.setItem('authToken', token);
}
