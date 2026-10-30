import type { Incident, Operation } from "./model.js";

export function applyOperation(
  incident: Incident,
  operation: Operation,
): Incident {
    
  if(operation.documentId !== incident.id){
    throw new Error(
    `Operation for ${operation.documentId} cannot be applied to ${incident.id}`,
  );
  }

  switch(operation.kind){

    case "set_title": 
    return {
        ...incident,
        title: operation.value,
    };
    case "set_status": 
    return {
        ...incident,
        status: operation.value
    };
    case "set_severity":
    return {
        ...incident,
        severity: operation.value
    };
  }

  
}