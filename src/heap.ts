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
