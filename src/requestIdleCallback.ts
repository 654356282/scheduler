function task(deadline: IdleDeadline) {
  // 如果浏览器有剩余时间，则可以执行对应的逻辑
  if(deadline.timeRemaining()) {

  }
  console.log(deadline.didTimeout, deadline.timeRemaining());
}
requestIdleCallback(task, { timeout: 10 });
