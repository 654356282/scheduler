import { PriorityLevel } from "./priorities.js";
import { peek, pop, push } from "./heap.js";
import {
  IdlePriority,
  ImmediatePriority,
  LowPriority,
  NormalPriority,
  UserBlockingPriority,
} from "./priorities.js";

const maxSigned31BitInt = 1073741823;

const IMMEDIATE_PRIORITY_TIMEOUT = -1;
const USER_BLOCKING_PRIORITY_TIMEOUT = 250;
const NORMAL_PRIORITY_TIMEOUT = 5000;
const LOW_PRIORITY_TIMEOUT = 10000;
const IDLE_PRIORITY_TIMEOUT = maxSigned31BitInt;

const taskQueue: Task[] = [];
const timerQueue: Task[] = [];

const frameYieldMs = 5;

let isHostCallbackScheduled = false;
let isPerformingWork = false;
let isMessageLoopRunning = false;
let isHostTimeoutScheduled = false;

let currentPriorityLevel = NORMAL_PRIORITY_TIMEOUT;

let scheduledHostCallback: any = null;

let taskIdCounter = 1;
let taskTimeoutID: NodeJS.Timeout = -1 as any;

let currentTask: Task | null = null;

let startTime = -1;

type Task = {
  id: number;
  callback: any;
  priorityLevel: PriorityLevel;
  startTime: number;
  expirationTime: number;
  sortIndex: number;
};

const getCurrentTime = () => performance.now();

const channel = new MessageChannel();
const port = channel.port2;
channel.port1.onmessage = performWorkUntilDeadline;
const schedulePerformWorkUntilDeadline = () => {
  port.postMessage(null);
};

function performWorkUntilDeadline() {
  if (scheduledHostCallback !== null) {
    // 存在已经调度过的任务
    const currentTime = getCurrentTime();
    startTime = currentTime;

    let hasMoreWork = true;
    try {
      hasMoreWork = flushWork(currentTime);
    } finally {
      if (hasMoreWork) {
        // 如果还有剩余任务，则继续调度
        schedulePerformWorkUntilDeadline();
      } else {
        // 表示本次MessageChannel发起的任务已经完成
        isMessageLoopRunning = false;
        scheduledHostCallback = null;
      }
    }
  } else {
    // 如果不存在已经调度过的
    isMessageLoopRunning = false;
  }
}

function advanceTimers(currentTime: number) {
  let timer = peek(timerQueue);
  while (timer !== null) {
    if (timer.callback === null) {
      // 该任务已经被取消或者被干过了，直接pass
      pop(timerQueue);
    } else if (timer.startTime <= currentTime) {
      pop(timerQueue);
      timer.sortIndex = timer.expirationTime;
      push(taskQueue, timer);
    } else {
      return;
    }
    timer = peek(timerQueue);
  }
}

function flushWork(initialTime: number) {
  isHostCallbackScheduled = false;
  if (isHostTimeoutScheduled) {
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }

  isPerformingWork = true;
  const previousPriorityLevel = currentPriorityLevel;
  try {
    return workLoop(initialTime);
  } finally {
    currentTask = null;
    currentPriorityLevel = previousPriorityLevel;
    isPerformingWork = false;
  }
}

function workLoop(initialTime: number) {
  let currentTime = initialTime;
  // 将timerQueue中的任务放入taskQueue中
  advanceTimers(currentTime);
  currentTask = peek(taskQueue);
  while (currentTask !== null) {
    if (currentTask.expirationTime > currentTime && shouldYieldToHost()) {
      // 时间分片
      break;
    }
    const callback = currentTask.callback;
    if (typeof callback === "function") {
      currentTask.callback = null;
      currentPriorityLevel = currentTask.priorityLevel;
      // 当前任务是否已经过了最晚执行时间
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;
      // 用户可以根据didUserCallbackTimeout做相应的操作
      const continuationCallback = callback(didUserCallbackTimeout);
      currentTime = getCurrentTime();
      if (typeof continuationCallback === "function") {
        // 如果用户返回了一个函数，则让该任务放在taskQueue中等待下轮调度呗
        currentTask.callback = continuationCallback;
      } else {
        // 防极端场景，比如执行优先级很低的任务的时候插入了一个优先级很高的任务，这时就不能直接弹出了
        if (currentTask === peek(taskQueue)) {
          pop(taskQueue);
        }
      }
      // 将timerQueue中的任务放入taskQueue中
      advanceTimers(currentTime);
    } else {
      // 如果这个任务已经执行过了，即callback为空，则直接弹出即可了
      pop(taskQueue);
    }
    currentTask = peek(taskQueue);
  }
  // 还有currentTask，说明活没干完，下个宏任务见
  if (currentTask !== null) {
    return true;
  } else {
    // 如果当前任务为空了，说明已经没任务可以执行了，则去timerQueue中看下第一个任务的开始时间，延迟一段时间后继续准备干活
    const firstTimer = peek(timerQueue);
    if (firstTimer !== null) {
      requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
    }
    return false;
  }
}

function requestHostCallback(callback: any) {
  scheduledHostCallback = callback;
  if (!isMessageLoopRunning) {
    isMessageLoopRunning = true;
    // 向MesaageChannel发送消息，触发performWorkUntilDeadline
    schedulePerformWorkUntilDeadline();
  }
}

function requestHostTimeout(callback: any, timeout: number) {
  taskTimeoutID = setTimeout(() => {
    // 此时callback是handleTimeout
    callback(getCurrentTime());
  }, timeout);
}

function cancelHostTimeout() {
  clearTimeout(taskTimeoutID);
  taskTimeoutID = -1 as unknown as any;
}

function handleTimeout(currentTime: number) {
  isHostTimeoutScheduled = false;
  advanceTimers(currentTime);

  if (!isHostCallbackScheduled) {
    if (peek(taskQueue) !== null) {
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    } else {
      const firstTimer = peek(timerQueue);
      if (firstTimer !== null) {
        requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
      }
    }
  }
}

function scheduleCallback(
  priorityLevel: PriorityLevel,
  callback: any,
  options?: { delay: number }
): Task {
  // 获取当前时间
  const currentTime = getCurrentTime();

  let startTime;
  // 根据currentTime和delay计算出任务开始时间
  if (options && options.delay) {
    startTime = currentTime + options.delay;
  } else {
    startTime = currentTime;
  }

  let timeout;
  // 根据priorityLevel换取任务的过期时长
  switch (priorityLevel) {
    case ImmediatePriority:
      timeout = IMMEDIATE_PRIORITY_TIMEOUT;
      break;
    case UserBlockingPriority:
      timeout = USER_BLOCKING_PRIORITY_TIMEOUT;
      break;
    case IdlePriority:
      timeout = IDLE_PRIORITY_TIMEOUT;
      break;
    case LowPriority:
      timeout = LOW_PRIORITY_TIMEOUT;
      break;
    case NormalPriority:
    default:
      timeout = NORMAL_PRIORITY_TIMEOUT;
      break;
  }

  // 根据任务开始时间和过期时长计算出任务的过期时间
  const expirationTime = startTime + timeout;

  const newTask: Task = {
    id: taskIdCounter++,
    callback,
    priorityLevel,
    startTime,
    expirationTime,
    sortIndex: -1,
  };

  if (startTime > currentTime) {
    // 如果该任务是延时任务，则将任务放入timerQueue中，以startTime排序
    newTask.sortIndex = startTime;
    push(timerQueue, newTask);
    // 如果taskQueue中没有任务而且timerQueue中的第一个任务等于当前任务，则在一段时间后再进行调度
    if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
      if (isHostTimeoutScheduled) {
        // 如果当前正处于等待阶段，则以新的时间重新开始等待
        cancelHostTimeout();
      } else {
        isHostTimeoutScheduled = true;
      }
      requestHostTimeout(handleTimeout, startTime - currentTime);
    }
  } else {
    // 如果任务不是延时任务，则将任务放入taskQueue中，以expirationTime排序
    newTask.sortIndex = expirationTime;
    push(taskQueue, newTask);

    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true;
      // 发起一轮宏任务去执行任务
      requestHostCallback(flushWork);
    }
  }
  return newTask;
}

function cancelCallback(task: Task) {
  task.callback = null;
}

const frameInterval = frameYieldMs;
function shouldYieldToHost() {
  const timeElapsed = getCurrentTime() - startTime;
  if (timeElapsed < frameInterval) {
    return false;
  }
  return true;
}

export {
  ImmediatePriority,
  UserBlockingPriority,
  NormalPriority,
  IdlePriority,
  LowPriority,
  scheduleCallback,
  getCurrentTime as now,
  cancelCallback,
  shouldYieldToHost as shouldYield,
};
