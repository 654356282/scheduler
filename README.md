# Schduler

* 应用场景

    有大量的**不同优先级**的任务需要执行，但想任务的**不执行阻塞**浏览器的渲染

* 功能需求
  1. 优先级调度
  2. 时间分片

* 使用方式

  往调度器中传入相应的优先级和回调函数，剩余的交给调度器自己去调度

  ```typescript
  function scheduleCallback(priorityLevel: PriorityLevel, cb: Callback, options?: {delay: number}): Task;
  ```

* 调度策略

  不需要延迟的任务比对

  1. **优先级相同**任务按传入顺序执行
  2. 优先级高比优先级低的任务先执行

  需要延迟的任务比对

  1. 根据延迟时间升序排序

  > 那么问题来了，怎么将延迟任务和非延迟任务比对呢？
  >
  > 只需要定义两个拥有排序功能的数据结构，一个用来存储不需要延迟的任务，一个用来存储需要延迟的任务，等时间到了第一个延迟任务的开始时间的时候，将该延迟任务放到不需要延迟的任务的数据结构中，重新排序即可。

* 数据结构

  对于这种需要动态排序的数据结构，堆是最适合的，这里我们选用小顶堆，堆顶的任务就是我们需要去处理的任务。

  ```typescript
  type Heap<T extends HeapNode> = T[];
  type HeapNode = {
    id: number;
    sortIndex: number;
  };
  
  export function push<T extends HeapNode>(heap: Heap<T>, node: T) {
    heap.push(node);
    heapInsert(heap, heap.length - 1);
  }
  
  export function peek<T extends HeapNode>(heap: Heap<T>) {
    return heap.length == 0 ? null : heap[0];
  }
  
  export function pop<T extends HeapNode>(heap: Heap<T>) {
    if (heap.length == 0) {
      return null;
    }
    const ans = heap[0];
    [heap[0], heap[heap.length - 1]] = [heap[heap.length - 1], heap[0]];
    heap.length--;
    heapify(heap, 0, heap.length);
    return ans;
  }
  
  function heapInsert<T extends HeapNode>(heap: Heap<T>, index: number) {
    while (index > 0) {
      const parentIdx = index >>> 1;
      const parent = heap[parentIdx];
      const node = heap[index];
      if (compare(parent, heap[index]) > 0) {
        heap[parentIdx] = node;
        heap[index] = parent;
        index = parentIdx;
      } else {
        return;
      }
    }
  }
  
  function heapify<T extends HeapNode>(heap: Heap<T>, index: number, heapSize: number) {
    const end = heapSize >>> 1;
    while (index < end) {
      const l = index * 2 + 1;
      const r = l + 1;
      let swapIndex = index;
      if (compare(heap[index], heap[l]) > 0) {
        if (r < heapSize && compare(heap[l], heap[r]) > 0) {
          swapIndex = r;
        } else {
          swapIndex = l;
        }
      } else if (r < heapSize && compare(heap[index], heap[r]) > 0) {
        swapIndex = r;
      } else {
        break;
      }
      [heap[index], heap[swapIndex]] = [heap[swapIndex], heap[index]];
    }
  }
  
  function compare<T extends HeapNode>(a: T, b: T) {
    const diff = a.sortIndex - b.sortIndex;
    return diff !== 0 ? diff : a.id - b.id;
  }
  
  ```

* 分发任务实现

  根据用户提供的优先级以及延迟时间，将任务分发到taskQueue或者timerQueue这两个小顶堆中，taskQueue存放不需要延迟的任务，timerQueue存放延迟任务。如果当前任务能够直接执行，则发起一轮宏任务去清空任务，否则延迟一段时间后再去清空任务

  ```typescript
  export const NoPriority = 0;
  export const ImmediatePriority = 1;
  export const UserBlockingPriority = 2;
  export const NormalPriority = 3;
  export const LowPriority = 4;
  export const IdlePriority = 5;
  
  export type PriorityLevel = 0 | 1 | 2 | 3 | 4 | 5;
  
  
  type Task = {
    id: number;
    callback: any;
    priorityLevel: PriorityLevel;
    startTime: number;
    expirationTime: number;
    sortIndex: number;
  };
  
  // 存储不需要延迟执行的任务
  const taskQueue: Task[] = [];
  // 存储需要延迟执行的任务
  const timerQueue: Task[] = [];
  
  const IMMEDIATE_PRIORITY_TIMEOUT = -1;
  const USER_BLOCKING_PRIORITY_TIMEOUT = 250;
  const NORMAL_PRIORITY_TIMEOUT = 5000;
  const LOW_PRIORITY_TIMEOUT = 10000;
  const IDLE_PRIORITY_TIMEOUT = 1 << (32 - 1);
  
  let taskIdCounter = 0;
  
  const getCurrentTime = () => performance.now();
  
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
  ```

* 发起宏任务，执行`flushWork`去执行任务，如果还有更多任务，则再发起一轮宏任务去执行

  ```typescript
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
          // 如果还有剩余任务，则再发起一轮宏任务去执行
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
  ```

* `flushWork`干了啥？

  主要就是用来调用`workLoop`的，这才是真正干活的地方

  ```typescript
  function flushWork(initialTime: number) {
    isHostCallbackScheduled = false;
    if (isHostTimeoutScheduled) {
      isHostTimeoutScheduled = false;
      cancelHostTimeout();
    }
  
    isPerformingWork = true;
    const previousPriorityLevel = currentPriorityLevel;
    try {
      // 真正干活的人
      return workLoop(initialTime);
    } finally {
      currentTask = null;
      currentPriorityLevel = previousPriorityLevel;
      isPerformingWork = false;
    }
  }
  ```

* `workLoop`打工人

  ```typescript
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
  ```

* `workLoop`中提到了一个`advanceTimers`，如果`workLoop`是打工人，那它就是流水线了，不断把`timerQueue`中可以执行的任务搬到`taskQueue`中，让`workLoop`干活

  ```typescript
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
  ```

  到这里，就是不需要延迟的任务的执行流程了

* 延迟任务怎么处理了，`scheduleCallback`提到了一个`requestHostTimeout`，他其实就相当于一个闹钟，延迟一定时间后，叫打工人打工

  ```typescript
  function requestHostTimeout(callback: any, timeout: number) {
    // 此时callback是handleTimeout
    taskTimeoutID = setTimeout(() => {
      callback(getCurrentTime());
    }, timeout);
  }
  
  // 闹钟一响
  function handleTimeout(currentTime: number) {
    isHostTimeoutScheduled = false;
    // 流水线开始搬运
    advanceTimers(currentTime);
  
    if (!isHostCallbackScheduled) {
      if (peek(taskQueue) !== null) {
        isHostCallbackScheduled = true;
        // workLoop打工人开始打工
        requestHostCallback(flushWork);
      } else {
        const firstTimer = peek(timerQueue);
        if (firstTimer !== null) {
          requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
        }
      }
    }
  }
  ```

  

> 扩展一下，react为啥还需要Lane？